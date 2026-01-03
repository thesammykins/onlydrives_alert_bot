import { Database } from '../services/database.js';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = './data';
const DB_PATH = path.join(DATA_DIR, 'bot.db');

function initDatabase(): void {
  console.log('Initializing database...');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created data directory: ${DATA_DIR}`);
  }

  const db = new Database(DB_PATH);
  console.log(`Database created at: ${DB_PATH}`);
  
  db.close();
  console.log('Database initialization complete.');
}

initDatabase();
