import { db, initDb } from './db.mjs'
import { hashPassword } from './pass.mjs'

const password = String(process.argv[2] || '')
if (password.length < 8 || password.length > 72) {
  console.error('Usage : npm run admin:password -- "NouveauMot8+"')
  process.exit(1)
}

await initDb()
const admin = await db.prepare('SELECT id, username FROM admins ORDER BY id ASC LIMIT 1').get()
if (!admin) {
  console.error('Aucun admin. Ouvre /admin une première fois pour le créer.')
  process.exit(1)
}

await db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(password), admin.id)
await db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(admin.id)
console.log(`Mot de passe changé pour « ${admin.username} ». Reconnecte-toi sur /admin.`)
process.exit(0)
