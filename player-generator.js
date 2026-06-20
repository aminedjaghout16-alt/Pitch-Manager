const { getDb } = require('./db');

// ─── Name pools ──────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'James','Daniel','Marcus','Harry','Jack','Oliver','Charlie','George','Lewis','Luke',
  'Ryan','Kyle','Ben','Tom','Will','Josh','Connor','Aaron','Mason','Kieran',
  'Carlos','Pablo','Sergio','Marco','Luis','Diego','Alejandro','Rafael','Miguel','Javier',
  'Fernando','Antonio','Alberto','Ivan','Adrián','Álvaro','Héctor','Rubén','Denis','Rodrigo',
  'Lukas','Timo','Kai','Leon','Jonas','Maximilian','Felix','Niklas','Julian','Tobias',
  'Sebastian','Florian','Moritz','Patrick','Stefan','Matthias','Philipp','Bastian','Marcel','Kevin',
  'Lucas','Théo','Hugo','Kylian','Antoine','Paul','Ousmane','Aurélien','Adrien','Nabil',
  'Olivier','Lilian','Florian','Wissam','Dimitri','Romain','Alexandre','Raphaël','Jules','Benoît',
  'Marco','Alessandro','Lorenzo','Andrea','Matteo','Federico','Luca','Gianluigi','Fabio','Roberto',
  'Stefano','Daniele','Claudio','Simone','Francesco','Antonio','Giuseppe','Giovanni','Paolo','Vincenzo',
  'Gabriel','Rafael','Lucas','Matheus','Felipe','Thiago','Bruno','Leonardo','Rodrigo','Eduardo',
  'Vinícius','Pedro','Gustavo','André','Diego','Renato','Marcelo','Adriano','Ricardo','Fábio',
  'João','Rui','Diogo','Rafael','Bernardo','André','Gonçalo','Tiago','Nuno','Cristiano',
  'Arjen','Wesley','Robin','Virgil','Matthijs','Frenkie','Donny','Ryan','Daley','Memphis',
  'Mohamed','Sadio','Kalidou','Riyad','Pierre','Aubameyang','Yaya','Samuel','Didier','George',
  'Luka','Ivan','Robert','Jan','Viktor','Marek','Patrik','Dominik','Milan','Darko'
];

const LAST_NAMES = [
  'Smith','Johnson','Williams','Brown','Taylor','Wilson','Davies','Evans','Thomas','Roberts',
  'Walker','Wright','Robinson','White','Thompson','Green','Hall','Clarke','Harris','Martin',
  'García','Rodríguez','Martínez','López','González','Hernández','Pérez','Sánchez','Ramírez','Torres',
  'Flores','Rivera','Morales','Cruz','Reyes','Gómez','Díaz','Muñoz','Romero','Ruiz',
  'Müller','Schmidt','Schneider','Fischer','Weber','Wagner','Becker','Hoffmann','Schulz','Koch',
  'Richter','Klein','Wolf','Schröder','Neumann','Schwarz','Braun','Zimmermann','Krüger','Hartmann',
  'Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau',
  'Simon','Laurent','Lefebvre','Michel','Garcia','Blanc','Fontaine','Rousseau','Girard','Bonnet',
  'Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Colombo','Ricci','Marino','Greco',
  'Bruno','Gallo','Conti','De Luca','Mancini','Costa','Giordano','Rizzo','Lombardi','Moretti',
  'Silva','Santos','Oliveira','Souza','Lima','Pereira','Costa','Ferreira','Rodrigues','Almeida',
  'Nascimento','Carvalho','Gomes','Martins','Araújo','Ribeiro','Rocha','Dias','Barbosa','Cardoso',
  'Fernandes','Gonçalves','Marques','Soares','Teixeira','Correia','Mendes','Nunes','Monteiro','Vieira',
  'De Jong','Van Dijk','De Bruyne','Bakker','Jansen','Visser','Smit','Meijer','De Groot','Bos',
  'Petrović','Novak','Horváth','Kowalski','Yilmaz','Okafor','Mensah','Diallo','Traoré','Keïta',
  'Modrić','Kovač','Jović','Pavlović','Stojanović','Ilić','Morić','Babić','Vukić','Tomović'
];

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'];
const POSITION_WEIGHTS = [3, 5, 3, 3, 3, 5, 3, 3, 3, 4];

const ATTR_WEIGHTS = {
  GK:  [0.05, 0.05, 0.10, 0.10, 0.10, 0.60],
  CB:  [0.10, 0.05, 0.10, 0.40, 0.30, 0.05],
  LB:  [0.25, 0.10, 0.20, 0.25, 0.15, 0.05],
  RB:  [0.25, 0.10, 0.20, 0.25, 0.15, 0.05],
  CDM: [0.15, 0.10, 0.25, 0.30, 0.20, 0.00],
  CM:  [0.15, 0.15, 0.30, 0.15, 0.20, 0.05],
  CAM: [0.20, 0.25, 0.30, 0.05, 0.15, 0.05],
  LW:  [0.30, 0.25, 0.20, 0.05, 0.15, 0.05],
  RW:  [0.30, 0.25, 0.20, 0.05, 0.15, 0.05],
  ST:  [0.20, 0.40, 0.10, 0.05, 0.20, 0.05],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function generateAttributes(position, ovr) {
  const weights = ATTR_WEIGHTS[position];
  const attrNames = ['pace', 'shooting', 'passing', 'defending', 'physical', 'goalkeeping'];
  const attrs = {};
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < attrNames.length; i++) {
    const ratio = (weights[i] / totalWeight) * attrNames.length;
    const base = Math.round(ovr * (0.6 + ratio * 0.4));
    const variance = rand(-5, 5);
    attrs[attrNames[i]] = clamp(base + variance, 1, 99);
  }
  return attrs;
}

function calculateOVR(position, attrs) {
  const weights = ATTR_WEIGHTS[position];
  const vals = [attrs.pace, attrs.shooting, attrs.passing, attrs.defending, attrs.physical, attrs.goalkeeping];
  let sum = 0, totalWeight = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i] * weights[i];
    totalWeight += weights[i];
  }
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

  let ageMult = 1;
  if (age < 23) ageMult = 1.3;
  else if (age < 27) ageMult = 1.1;
  else if (age < 30) ageMult = 1.0;
  else if (age < 33) ageMult = 0.7;
  else ageMult = 0.4;

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

  const ageMult = age < 25 ? 0.9 : age < 30 ? 1.0 : 0.8;
  return Math.round(base * ageMult);
}

function pickWeightedPosition() {
  const total = POSITION_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < POSITIONS.length; i++) {
    r -= POSITION_WEIGHTS[i];
    if (r <= 0) return POSITIONS[i];
  }
  return POSITIONS[POSITIONS.length - 1];
}

function generateAge(ovr) {
  if (ovr >= 80) return rand(24, 33);
  if (ovr >= 70) return rand(21, 32);
  if (ovr >= 60) return rand(18, 30);
  return rand(17, 28);
}

// ─── Public API ──────────────────────────────────────────────────────────────

function generatePlayer(clubId, forcedPosition = null, targetOvr = null) {
  const position = forcedPosition || pickWeightedPosition();
  const ovr = targetOvr || rand(45, 82);
  const age = generateAge(ovr);
  const attrs = generateAttributes(position, ovr);
  const actualOvr = calculateOVR(position, attrs);
  const potential = Math.max(actualOvr, Math.min(99, actualOvr + (age < 24 ? rand(2, 12) : age < 28 ? rand(0, 5) : 0)));

  return {
    club_id: clubId,
    first_name: pick(FIRST_NAMES),
    last_name: pick(LAST_NAMES),
    age,
    position,
    ovr: actualOvr,
    ...attrs,
    potential,
    value: calculateValue(actualOvr, age, position),
    salary: calculateSalary(actualOvr, age),
    fitness: rand(85, 100),
    morale: rand(60, 90),
  };
}

function generateSquad(clubId, avgOvr = 65) {
  const squad = [];
  const distribution = [
    { pos: 'GK', count: 3 }, { pos: 'CB', count: 5 }, { pos: 'LB', count: 3 },
    { pos: 'RB', count: 3 }, { pos: 'CDM', count: 3 }, { pos: 'CM', count: 5 },
    { pos: 'CAM', count: 3 }, { pos: 'LW', count: 3 }, { pos: 'RW', count: 3 },
    { pos: 'ST', count: 4 },
  ];
  for (const { pos, count } of distribution) {
    for (let i = 0; i < count; i++) {
      const variance = rand(-5, 5);
      const targetOvr = clamp(avgOvr + variance, 40, 90);
      squad.push(generatePlayer(clubId, pos, targetOvr));
    }
  }
  return squad;
}

// Now async — inserts into Turso
async function insertPlayer(player) {
  const db = getDb();
  const result = await db.execute({
    sql: `INSERT INTO players (club_id, first_name, last_name, age, position, ovr,
            pace, shooting, passing, defending, physical, goalkeeping, potential,
            value, salary, fitness, morale, is_listed, asking_price)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      player.club_id, player.first_name, player.last_name, player.age,
      player.position, player.ovr, player.pace, player.shooting, player.passing,
      player.defending, player.physical, player.goalkeeping, player.potential,
      player.value, player.salary, player.fitness, player.morale,
      player.is_listed || 0, player.asking_price || 0
    ]
  });
  return result;
}

function generateTransferMarket(count = 40) {
  const players = [];
  for (let i = 0; i < count; i++) {
    const ovr = rand(50, 80);
    const p = generatePlayer(0, null, ovr);
    p.is_listed = 1;
    p.asking_price = Math.round(p.value * (1 + Math.random() * 0.3));
    players.push(p);
  }
  return players;
}

module.exports = {
  generatePlayer,
  generateSquad,
  insertPlayer,
  generateTransferMarket,
  calculateValue,
  calculateSalary,
  calculateOVR,
  POSITIONS,
  FIRST_NAMES,
  LAST_NAMES,
};
