/**
 * 開発用ユーザー登録スクリプト
 *
 * 使い方:
 *   pnpm create-user <username> <password>
 *
 * 出力された wrangler コマンドを実行すると KV にユーザーが登録される
 */

import { hashPassword } from "../src/lib/auth.js";

async function main() {
  const username = process.argv[2];
  const password = process.argv[3];

  if (!username || !password) {
    console.error("使い方: pnpm create-user <username> <password>");
    process.exit(1);
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    console.error("エラー: username は英数字、ハイフン、アンダースコアのみ使用可能です");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const userData = JSON.stringify({
    passwordHash,
    createdAt: new Date().toISOString(),
  });

  console.log(`\nユーザー: ${username}`);
  console.log(`\n以下のコマンドで KV にユーザーを登録してください:\n`);
  console.log(
    `npx wrangler kv key put --binding SESSION "users:${username}" '${userData}' --preview`
  );
  console.log(`\nまたは本番環境:`);
  console.log(
    `npx wrangler kv key put --binding SESSION "users:${username}" '${userData}'`
  );
}

main().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});
