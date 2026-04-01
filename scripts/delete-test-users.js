/**
 * Admin script to find and delete Supabase users with "test" in their email.
 *
 * Deletes dependent rows from application tables first to avoid FK constraint
 * violations, then removes the user from auth.users.
 *
 * Usage:
 *   node scripts/delete-test-users.js
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://tczqtwxrnptgajxwynmg.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Error: Set SUPABASE_SERVICE_ROLE_KEY environment variable before running.\n" +
    "  export SUPABASE_SERVICE_ROLE_KEY='your-service-role-key'\n" +
    "  node scripts/delete-test-users.js"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Tables that reference auth.users(id) and need rows cleaned up before deletion.
// Order matters — delete from child/dependent tables first.
const DEPENDENT_TABLES = [
  // Messaging tables (may or may not exist)
  { table: "messages",        columns: ["sender_id"] },
  { table: "channel_members", columns: ["user_id"] },
  // Social tables
  { table: "shared_items",    columns: ["from_user_id", "to_user_id"] },
  { table: "friend_requests", columns: ["from_user_id", "to_user_id"] },
  // Misc
  { table: "feedback",        columns: ["user_id"] },
  // Profile (primary user data)
  { table: "profiles",        columns: ["id"] },
];

async function deleteRowsForUser(userId) {
  let totalDeleted = 0;

  for (const { table, columns } of DEPENDENT_TABLES) {
    for (const col of columns) {
      const { data, error, count } = await supabase
        .from(table)
        .delete({ count: "exact" })
        .eq(col, userId);

      if (error) {
        // Table might not exist or column name might differ — log and continue
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          console.log(`  [skip] Table "${table}" does not exist`);
          break; // skip remaining columns for this table
        }
        console.warn(`  [warn] ${table}.${col}: ${error.message}`);
        continue;
      }

      const deleted = count ?? 0;
      if (deleted > 0) {
        console.log(`  [ok]   Deleted ${deleted} row(s) from ${table} where ${col} = user`);
      }
      totalDeleted += deleted;
    }
  }

  return totalDeleted;
}

async function main() {
  console.log("Fetching users...\n");

  // List all users (paginate if needed)
  const allUsers = [];
  let page = 1;
  while (true) {
    const { data: { users }, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) {
      console.error("Failed to list users:", error.message);
      process.exit(1);
    }
    allUsers.push(...users);
    if (users.length < 100) break;
    page++;
  }

  const testUsers = allUsers.filter(
    (u) => u.email && u.email.toLowerCase().includes("test")
  );

  console.log(`Total users: ${allUsers.length}`);
  console.log(`Users with "test" in email: ${testUsers.length}\n`);

  if (testUsers.length === 0) {
    console.log("No test users found. Nothing to do.");
    return;
  }

  for (const user of testUsers) {
    console.log(`--- ${user.email} (${user.id}) ---`);
    console.log(`    Created: ${user.created_at}`);
    console.log(`    Last sign-in: ${user.last_sign_in_at ?? "never"}\n`);

    // 1. Remove dependent rows
    console.log("  Cleaning dependent rows...");
    const rowsDeleted = await deleteRowsForUser(user.id);
    console.log(`  Total dependent rows removed: ${rowsDeleted}\n`);

    // 2. Delete the auth user
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      console.error(`  [FAIL] Could not delete user: ${error.message}\n`);
      continue;
    }
    console.log(`  [ok]   User deleted from auth.users\n`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
