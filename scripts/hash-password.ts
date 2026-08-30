import { hashPassword } from "../src/server/auth.js";

const password = process.env.MONITOR_PASSWORD_TO_HASH;

if (!password) {
  console.error(
    "Set MONITOR_PASSWORD_TO_HASH temporarily, then run npm run password:hash.",
  );
  process.exit(1);
}

console.log(await hashPassword(password));
