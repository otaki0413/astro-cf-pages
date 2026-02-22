type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {
		user: { username: string } | null;
	}
}

declare module "cloudflare:test" {
	interface ProvidedEnv extends Env {}
}
