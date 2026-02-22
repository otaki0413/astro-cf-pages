export type SessionData = {
  username: string;
  expiresAt: number;
};

export type UserData = {
  passwordHash: string;
  createdAt: string;
};

export async function saveSession(
  kv: KVNamespace,
  token: string,
  data: SessionData,
  ttlSeconds: number
): Promise<void> {
  await kv.put(`sessions:${token}`, JSON.stringify(data), {
    expirationTtl: ttlSeconds,
  });
}

export async function getSession(
  kv: KVNamespace,
  token: string
): Promise<SessionData | null> {
  return await kv.get<SessionData>(`sessions:${token}`, "json");
}

export async function deleteSession(
  kv: KVNamespace,
  token: string
): Promise<void> {
  await kv.delete(`sessions:${token}`);
}

export async function saveUser(
  kv: KVNamespace,
  username: string,
  data: UserData
): Promise<void> {
  await kv.put(`users:${username}`, JSON.stringify(data));
}

export async function getUser(
  kv: KVNamespace,
  username: string
): Promise<UserData | null> {
  return await kv.get<UserData>(`users:${username}`, "json");
}
