/**
 * Editor-only ambient declarations.
 *
 * This file is NOT deployed and NOT part of the real Deno program — `deno.json`
 * excludes it, so `supabase functions deploy` and `deno check` always use the
 * genuine Deno + npm types pulled from the URL import.
 *
 * It exists only so that editors running the plain TypeScript language service
 * (without the Deno extension) can resolve the Deno global namespace and the
 * `https://esm.sh/...` specifier used by Edge Functions.
 */

declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    has(key: string): boolean;
    delete(key: string): void;
    toObject(): Record<string, string>;
  }

  export const env: Env;

  export interface ServeHandlerInfo {
    remoteAddr: { transport: string; hostname: string; port: number };
  }

  export type ServeHandler = (
    request: Request,
    info: ServeHandlerInfo,
  ) => Response | Promise<Response>;

  export interface HttpServer {
    finished: Promise<void>;
    shutdown(): Promise<void>;
  }

  export function serve(handler: ServeHandler, options?: unknown): HttpServer;
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  export type SupabaseUserLike = {
    id: string;
    email?: string | null;
  };

  export type SupabaseErrorLike = {
    message: string;
    status?: number;
    code?: string;
  } | null;

  export type AuthClientLike = {
    getUser(jwt?: string): Promise<{ data: { user: SupabaseUserLike | null }; error: SupabaseErrorLike }>;
    admin: {
      signOut(jwt: string, scope?: "global" | "local" | "others"): Promise<{ error: SupabaseErrorLike }>;
      deleteUser(id: string): Promise<{ error: SupabaseErrorLike }>;
    };
  };

  export type ClientLike = {
    auth: AuthClientLike;
  };

  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: {
      auth?: { persistSession?: boolean; autoRefreshToken?: boolean };
    },
  ): ClientLike;
}