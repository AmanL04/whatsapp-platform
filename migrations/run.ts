import 'dotenv/config'
import { runMigrations } from './runner'

const dbPath = process.env.DB_PATH ?? './data/whatsapp.db'
runMigrations(dbPath)
