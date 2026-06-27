// Database configuration - supports Firebase or local development
let db = null;
let useLocalDB = false;

// Auto-detect: use local DB if no Firebase credentials or if explicitly set
if (process.env.NODE_ENV === 'development' || 
    process.env.USE_LOCAL_DB === 'true' ||
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !process.env.FIREBASE_PRIVATE_KEY) {
  useLocalDB = true;
  console.log('🔧 Using local development database (no Firebase credentials detected)');
}

// Local in-memory database for development
class LocalDB {
  constructor() {
    this.collections = {};
  }

  collection(name) {
    if (!this.collections[name]) {
      this.collections[name] = new LocalCollection(name);
    }
    return this.collections[name];
  }

  batch() {
    return {
      updates: [],
      sets: [],
      deletes: [],
      update(ref, data) { this.updates.push({ ref, data }); },
      set(ref, data) { this.sets.push({ ref, data }); },
      delete(ref) { this.deletes.push({ ref }); },
      async commit() {
        // Apply all operations
        for (const { ref, data } of this.updates) {
          await ref.update(data);
        }
        for (const { ref, data } of this.sets) {
          await ref.set(data);
        }
        for (const { ref } of this.deletes) {
          await ref.delete();
        }
      }
    };
  }
}

class LocalCollection {
  constructor(name) {
    this.name = name;
    this.docs = {};
    this.autoId = 1;
  }

  doc(id) {
    if (!id) {
      id = String(this.autoId++);
    }
    const collection = this;
    const docId = id;
    
    const docRef = {
      id: docId,
      collection: collection,
      get: async function() {
        const data = collection.docs[docId];
        return {
          id: docId,
          exists: !!data,
          data: function() { return data ? JSON.parse(JSON.stringify(data)) : null; },
          ref: docRef
        };
      },
      set: async function(data) {
        collection.docs[docId] = JSON.parse(JSON.stringify(data));
      },
      update: async function(data) {
        if (!collection.docs[docId]) {
          collection.docs[docId] = {};
        }
        // Handle FieldValue.increment
        for (const [key, value] of Object.entries(data)) {
          if (value && value._methodName === 'increment') {
            const current = collection.docs[docId][key] || 0;
            collection.docs[docId][key] = current + value._operand;
          } else {
            collection.docs[docId][key] = value;
          }
        }
      },
      delete: async function() {
        delete collection.docs[docId];
      }
    };
    
    return docRef;
  }

  async add(data) {
    const id = String(this.autoId++);
    this.docs[id] = JSON.parse(JSON.stringify(data));
    return this.doc(id);
  }

  where(field, op, value) {
    const collection = this;
    const filterFn = (doc) => {
      if (op === '==') return doc[field] === value;
      if (op === '!=') return doc[field] !== value;
      if (op === '<') return doc[field] < value;
      if (op === '<=') return doc[field] <= value;
      if (op === '>') return doc[field] > value;
      if (op === '>=') return doc[field] >= value;
      return true;
    };
    const initialResults = Object.entries(this.docs)
      .filter(([id, doc]) => filterFn(doc));

    const makeSnapshot = (entries) => {
      const results = entries.map(([id, doc]) => {
        const docRef = collection.doc(id);
        return {
          id,
          data: function() { return JSON.parse(JSON.stringify(doc)); },
          ref: docRef
        };
      });

      const snapshot = {
        docs: results,
        empty: results.length === 0,
        size: results.length,
        where: function(field2, op2, value2) {
          const filtered = entries.filter(([id, doc]) => {
            if (op2 === '==') return doc[field2] === value2;
            if (op2 === '!=') return doc[field2] !== value2;
            if (op2 === '<') return doc[field2] < value2;
            if (op2 === '<=') return doc[field2] <= value2;
            if (op2 === '>') return doc[field2] > value2;
            if (op2 === '>=') return doc[field2] >= value2;
            return true;
          });
          return makeSnapshot(filtered);
        },
        orderBy: function(field, direction = 'asc') {
          const sorted = [...entries].sort((a, b) => {
            const aVal = a[1][field];
            const bVal = b[1][field];
            if (direction === 'asc') return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
          });
          const sortedResults = sorted.map(([id, doc]) => {
            const docRef = collection.doc(id);
            return {
              id,
              data: function() { return JSON.parse(JSON.stringify(doc)); },
              ref: docRef
            };
          });
          return {
            docs: sortedResults,
            empty: sortedResults.length === 0,
            size: sortedResults.length,
            limit: function(n) {
              return {
                docs: sortedResults.slice(0, n),
                empty: sortedResults.length === 0,
                get: async function() { return this; }
              };
            },
            get: async function() { return this; }
          };
        },
        limit: function(n) {
          return {
            docs: results.slice(0, n),
            empty: results.length === 0,
            get: async function() { return this; }
          };
        },
        get: async function() { return snapshot; }
      };
      return snapshot;
    };

    return makeSnapshot(initialResults);
  }

  orderBy(field, direction = 'asc') {
    const collection = this;
    const docs = Object.entries(this.docs)
      .map(([id, doc]) => {
        const docRef = collection.doc(id);
        return { 
          id, 
          data: function() { return JSON.parse(JSON.stringify(doc)); }, 
          ref: docRef 
        };
      })
      .sort((a, b) => {
        const aVal = a.data()[field];
        const bVal = b.data()[field];
        if (direction === 'asc') return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      });
    
    const querySnapshot = {
      docs: docs,
      empty: docs.length === 0,
      size: docs.length,
      limit: function(n) { 
        return { 
          docs: docs.slice(0, n), 
          empty: docs.length === 0,
          get: async function() { return this; }
        }; 
      },
      get: async function() { return querySnapshot; }
    };
    
    return querySnapshot;
  }

  limit(n) {
    const collection = this;
    const docs = Object.entries(this.docs)
      .slice(0, n)
      .map(([id, doc]) => {
        const docRef = collection.doc(id);
        return { 
          id, 
          data: function() { return JSON.parse(JSON.stringify(doc)); }, 
          ref: docRef 
        };
      });
    
    return {
      docs: docs,
      empty: docs.length === 0,
      size: docs.length,
      get: async function() { return this; }
    };
  }

  // For queries that call get() directly on the collection
  async get() {
    const collection = this;
    const docs = Object.entries(this.docs)
      .map(([id, doc]) => {
        const docRef = collection.doc(id);
        return {
          id,
          data: function() { return JSON.parse(JSON.stringify(doc)); },
          ref: docRef
        };
      });
    
    return {
      docs: docs,
      empty: docs.length === 0,
      size: docs.length
    };
  }
}

// FieldValue mock for local development
class FieldValue {
  static increment(operand) {
    return { _methodName: 'increment', _operand: operand };
  }
}

function getDb() {
  if (useLocalDB) {
    if (!db) {
      db = new LocalDB();
    }
    return db;
  }

  // Firebase mode
  if (!db) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
    db = admin.firestore();
  }
  return db;
}

module.exports = { getDb, useLocalDB, FieldValue };
