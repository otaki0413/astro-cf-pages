/**
 * 開発用ユーザー登録スクリプト
 *
 * 使い方:
 *   npx tsx scripts/create-user.ts <username> <password>
 *
 * 出力された wrangler コマンドを実行すると KV にユーザーが登録される
 */

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function main() {
  const username = process.argv[2];
  const password = process.argv[3];

  if (!username || !password) {
    console.error("使い方: npx tsx scripts/create-user.ts <username> <password>");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const userData = JSON.stringify({
    passwordHash,
    createdAt: new Date().toISOString(),
  });

  console.log(`\nユーザー: ${username}`);
  console.log(`パスワード: ${password}`);
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
