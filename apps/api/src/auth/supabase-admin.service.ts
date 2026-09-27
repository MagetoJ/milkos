import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuthConfig } from './auth.config';

/** Server-only wrapper around the Supabase Auth admin API (service-role key). */
@Injectable()
export class SupabaseAdminService {
  private readonly client?: SupabaseClient;

  constructor(private readonly config: AuthConfig) {
    if (config.serviceRoleKey) {
      this.client = createClient(config.supabaseUrl, config.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
  }

  private get admin() {
    if (!this.client) throw new ServiceUnavailableException('User invitations require SUPABASE_SERVICE_ROLE_KEY on the API');
    return this.client.auth.admin;
  }

  /**
   * Sends an invitation email and returns the Supabase user id. If the address
   * already has an account, no email is sent and the existing id is returned.
   */
  async inviteByEmail(email: string, displayName?: string): Promise<{ authUserId: string; invited: boolean }> {
    const invite = await this.admin.inviteUserByEmail(email, {
      redirectTo: `${this.config.webUrl}/reset-password?invited=1`,
      data: displayName ? { full_name: displayName } : undefined,
    });
    if (invite.data.user) return { authUserId: invite.data.user.id, invited: true };

    // Existing account: generateLink resolves the user without emailing them.
    const existing = await this.admin.generateLink({ type: 'magiclink', email });
    if (existing.data.user) return { authUserId: existing.data.user.id, invited: false };
    throw new ServiceUnavailableException(invite.error?.message || 'Could not invite user');
  }

  /** Blocks refresh-token use so a suspended user cannot mint new sessions. */
  async setBanned(authUserId: string, banned: boolean) {
    if (!this.client) return;
    await this.admin.updateUserById(authUserId, { ban_duration: banned ? '876000h' : 'none' });
  }
}
