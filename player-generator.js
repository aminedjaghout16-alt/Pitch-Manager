const { getDb } = require('./db');

const FIRST_NAMES = [
  'James','Daniel','Marcus','Harry','Jack','Oliver','Charlie','George','Lewis','Luke',
  'Ryan','Kyle','Ben','Tom','Will','Josh','Connor','Aaron','Mason','Kieran',
  'Carlos','Pablo','Sergio','Marco','Luis','Diego','Alejandro','Rafael','Miguel','Javier',
  'Fernando','Antonio','Alberto','Ivan','Álvaro','Héctor','Rubén','Denis','Rodrigo',
  'Lukas','Timo','Kai','Leon','Jonas','Maximilian','Felix','Niklas','Julian','Tobias',
  'Sebastian','Florian','Moritz','Patrick','Stefan','Matthias','Philipp','Bastian','Marcel','Kevin',
  'Lucas','Théo','Hugo','Kylian','Antoine','Paul','Ousmane','Aurélien','Adrien','Nabil',
  'Marco','Alessandro','Lorenzo','Andrea','Matteo','Federico','Luca','Gianluigi','Fabio','Roberto',
  'Gabriel','Rafael','Matheus','Felipe','Thiago','Bruno','Leonardo','Eduardo','Vinícius','Pedro',
  'João','Rui','Diogo','Bernardo','André','Gonçalo','Tiago','Nuno','Cristiano',
  'Arjen','Wesley','Robin','Virgil','Matthijs','Frenkie','Donny','Daley','Memphis',
  'Mohamed','Sadio','Kalidou','Riyad','Pierre','Yaya','Samuel','Didier','George',
  'Luka','Ivan','Robert','Jan','Viktor','Marek','Patrik','Dominik','Milan','Darko'
];

const LAST_NAMES = [
  'Smith','Johnson','Williams','Brown','Taylor','Wilson','Davies','Evans','Thomas','Roberts',
  'Walker','Wright','Robinson','White','Thompson','Green','Hall','Clarke','Harris','Martin',
  'García','Rodríguez','Martínez','López','González','Hernández','Pérez','Sánchez','Ramírez','Torres',
  'Flores','Rivera','Morales','Cruz','Reyes','Gómez','Díaz','Muñoz','Romero','Ruiz',
  'Müller','Schmidt','Schneider','Fischer','Weber','Wagner','Becker','Hoffmann','Schulz','Koch',
  'Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Colombo','Ricci','Marino','Greco',
  'Silva','Santos','Oliveira','Souza','Lima','Pereira','Costa','Ferreira','Rodrigues','Almeida',
  'Fernandes','Gonçalves','Marques','Soares','Teixeira','Correia','Mendes','Nunes','Monteiro','Vieira',
  'De Jong','Van Dijk','Bakker','Jansen','Visser','Smit','Meijer','De Groot','Bos',
  'Petrović','Novak','Horváth','Kowalski','Yilmaz','Okafor','Mensah','Diallo','Traoré','Keïta',
  'Modrić','Kovač','Jović','Pavlović','Stojanović','Ilić','Tomović'
];

const POSITIONS = ['GK','CB','LB','RB','CDM','CM','CAM','LW','RW','ST'];
const POSITION_WEIGHTS = [3,5,3,3,3,5,3,3,3,4];

const ATTR_WEIGHTS = {
  GK:  [0.05,0.05,0.10,0.10,0.10,0.60],
  CB:  [0.10,0.05,0.10,0.40,0.30,0.05],
  LB:  [0.25,0.10,0.20,0.25,0.15,0.05],
  RB:  [0.25,0.10,0.20,0.25,0.15,0.05],
  CDM: [0.15,0.10,0.25,0.30,0.20,0.00],
  CM:  [0.15,0.15,0.30,0.15,0.20,0.05],
  CAM: [0.20,0.25,0.30,0.05,0.15,0.05],
  LW:  [0.30,0.25,0.20,0.05,0.15,0.05],
  RW:  [0.30,0.25,0.20,0.05,0.15,0.05],
  ST:  [0.20,0.40,0.10,0.05,0.20,0.05],
};

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function generateAttributes(position, ovr) {
  const weights = ATTR_WEIGHTS[position];
  const attrNames = ['pace','shooting','passing','defending','physical','goalkeeping'];
  const attrs = {};
  const totalWeight = weights.reduce((a,b) => a+b, 0);
  for (let i = 0; i < attrNames.length; i++) {
    const ratio = (weights[i] / totalWeight) * attrNames.length;
    const base = Math.round(ovr * (0.6 + ratio * 0.4));
    attrs[attrNames[i]] = clamp(base + rand(-5,5), 1, 99);
  }
  return attrs;
}

function calculateOVR(position, attrs) {
  const weights = ATTR_WEIGHTS[position];
  const vals = [attrs.pace,attrs.shooting,attrs.passing,attrs.defending,attrs.physical,attrs.goalkeeping];
  let sum = 0, totalWeight = 0;
  for (let i = 0; i < vals.length; i++) { sum += (vals[i]||50) * weights[i]; totalWeight += weights[i]; }
  return Math.round(sum / totalWeight);
}

function calculateValue(ovr, age, position) {
  let base;
  if (ovr >= 85) base = 80000000;
  else if (ovr >= 80) base = 40000000;
  else if (ovr >= 75) base = 15000000;
  else if (ovr >= 70) base = 5000000;
  else if (ovr >= 65) base = 2000000;
  else if (ovr >= 60) base = 800000;
  else if (ovr >= 55) base = 300000;
  else base = 100000;
  const ageMult = age < 23 ? 1.3 : age < 27 ? 1.1 : age < 30 ? 1.0 : age < 33 ? 0.7 : 0.4;
  const posMult = position === 'ST' ? 1.2 : position === 'CAM' ? 1.1 : position === 'GK' ? 0.9 : 1.0;
  return Math.round(base * ageMult * posMult);
}

function calculateSalary(ovr, age) {
  let base;
  if (ovr >= 85) base = 300000;
  else if (ovr >= 80) base = 150000;
  else if (ovr >= 75) base = 80000;
  else if (ovr >= 70) base = 40000;
  else if (ovr >= 65) base = 20000;
  else if (ovr >= 60) base = 10000;
  else if (ovr >= 55) base = 5000;
  else base = 2000;
  return Math.round(base * (age < 25 ? 0.9 : age < 30 ? 1.0 : 0.8));
}

function pickWeightedPosition() {
  const total = POSITION_WEIGHTS.reduce((a,b) => a+b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < POSITIONS.length; i++) { r -= POSITION_WEIGHTS[i]; if (r <= 0) return POSITIONS[i]; }
  return POSITIONS[POSITIONS.length - 1];
}

function generateAge(ovr) {
  if (ovr >= 80) return rand(24,33);
  if (ovr >= 70) return rand(21,32);
  if (ovr >= 60) return rand(18,30);
  return rand(17,28);
}

function generatePlayer(clubId, forcedPosition = null, targetOvr = null) {
  const position = forcedPosition || pickWeightedPosition();
  const ovr = targetOvr || rand(45,82);
  const age = generateAge(ovr);
  const attrs = generateAttributes(position, ovr);
  const actualOvr = calculateOVR(position, attrs);
  const potential = Math.max(actualOvr, Math.min(99, actualOvr + (age < 24 ? rand(2,12) : age < 28 ? rand(0,5) : 0)));
  
  // Contract length (1-5 years)
  const contractYears = rand(1,5);
  
  return {
    clubId: clubId || 'free',
    firstName: pick(FIRST_NAMES),
    lastName: pick(LAST_NAMES),
    age, position,
    ovr: actualOvr,
    ...attrs,
    potential,
    value: calculateValue(actualOvr, age, position),
    salary: calculateSalary(actualOvr, age),
    fitness: rand(85,100),
    morale: rand(60,90),
    form: rand(60,90), // Current form (affects match performance)
    goals: 0, assists: 0, appearances: 0,
    yellowCards: 0, redCards: 0,
    injuryType: null, injuryWeeks: 0, suspended: false,
    isListed: false, askingPrice: 0,
    contractYears, // Years remaining on contract
  };
}

function generateSquad(clubId, avgOvr = 65) {
  const squad = [];
  const distribution = [
    {pos:'GK',count:3},{pos:'CB',count:5},{pos:'LB',count:3},{pos:'RB',count:3},
    {pos:'CDM',count:3},{pos:'CM',count:5},{pos:'CAM',count:3},
    {pos:'LW',count:3},{pos:'RW',count:3},{pos:'ST',count:4},
  ];
  for (const {pos, count} of distribution) {
    for (let i = 0; i < count; i++) {
      squad.push(generatePlayer(clubId, pos, clamp(avgOvr + rand(-5,5), 40, 90)));
    }
  }
  return squad;
}

async function insertPlayer(player) {
  const db = getDb();
  const ref = await db.collection('players').add(player);
  return ref.id;
}

function generateTransferMarket(count = 40) {
  const players = [];
  for (let i = 0; i < count; i++) {
    const ovr = rand(50,80);
    const p = generatePlayer('free', null, ovr);
    p.isListed = true;
    p.askingPrice = Math.round(p.value * (1 + Math.random() * 0.3));
    players.push(p);
  }
  return players;
}

module.exports = { generatePlayer, generateSquad, insertPlayer, generateTransferMarket, calculateValue, calculateSalary, calculateOVR, POSITIONS };
