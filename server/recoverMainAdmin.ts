import { storage } from "./storage";
import crypto from "node:crypto";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function generateTemporaryPassword() {
  return `KC-${crypto.randomBytes(6).toString("base64url")}!A9`;
}

async function run() {
  const main = await storage.getActiveMainAdmin();
  if (!main) {
    throw new Error("No active Main Admin found. Restore a valid admin account first.");
  }
  const temporaryPassword = generateTemporaryPassword();
  await storage.updateUser(main.id, {
    passwordHash: hashPassword(temporaryPassword),
    mustChangePassword: true,
    failedLoginAttempts: 0,
    temporaryLockUntil: null,
    isFullyLocked: false,
    isActive: true,
  });
  console.log(`Main Admin recovery complete for ${main.email}`);
  console.log(`Temporary password: ${temporaryPassword}`);
}

run().catch((error) => {
  console.error("Main Admin recovery failed:", error);
  process.exit(1);
});
