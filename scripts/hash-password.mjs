import { pbkdf2Sync, randomBytes } from "node:crypto";

const password = process.argv[2] || process.env.ADMIN_PASSWORD;
if (!password) {
  console.error('Uso: npm run hash:password -- "SUA-SENHA-FORTE"');
  process.exit(1);
}

const iterations = 210000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const b64url = (buf) => buf.toString("base64url");
console.log(`pbkdf2$${iterations}$${b64url(salt)}$${b64url(hash)}`);
