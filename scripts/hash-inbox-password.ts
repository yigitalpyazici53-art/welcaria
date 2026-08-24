/**
 * Generates one INBOX_OPERATORS entry.
 *
 *   npm run inbox-hash -- <operatorId> "<Full Name>" "<password>"
 *
 * Prints the JSON object to paste into the INBOX_OPERATORS array. Plaintext
 * passwords are never stored anywhere — only the scrypt hash goes into the env
 * var. Run this locally, hand the operator their password out of band, and put
 * only the printed object in Vercel.
 */
import { hashPassword } from "../lib/inboxOperators";

async function main(): Promise<void> {
  const [operatorId, name, password] = process.argv.slice(2);

  if (!operatorId || !name || !password) {
    console.error(
      'Usage: npm run inbox-hash -- <operatorId> "<Full Name>" "<password>"'
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Refusing: password must be at least 12 characters.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const entry = { operatorId: operatorId.trim().toLowerCase(), name: name.trim(), passwordHash };

  console.log("\nOperator entry:\n");
  console.log(JSON.stringify(entry, null, 2));
  console.log("\nAdd it to the INBOX_OPERATORS JSON array (single line for the env var):\n");
  console.log(JSON.stringify([entry]));
  console.log(
    "\nExisting operators: keep them in the same array — INBOX_OPERATORS holds ALL operators.\n"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
