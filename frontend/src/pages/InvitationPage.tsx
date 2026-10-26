import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, ErrorText, Spinner } from '../components/ui';
import { LangToggle } from '../components/LangToggle';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useApi } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { BrandLogo } from '../components/BrandLogo';
import { PwaInstallPrompt } from '../components/PwaInstallPrompt';

interface InvitationPreview { invitation: { groupId: string; groupName: string; invitedName: string; expiresAt: string } }

export function InvitationPage() {
  const { token = '' } = useParams();
  const { user, ready } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const { data, loading, error } = useApi<InvitationPreview>(token ? `/invitations/${encodeURIComponent(token)}` : null);
  const accept = useAction();
  const returnTo = `/invite/${token}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-8">
      <section className="card w-full max-w-lg space-y-4 !p-6">
        <PwaInstallPrompt tone="light" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-semibold text-brand-700"><BrandLogo size={34} />{t('appName')}</div>
          <LangToggle />
        </div>
        <h1 className="text-xl font-bold">{t('invitedToGroup')}</h1>
        {!ready || loading ? <Spinner /> : error || !data ? (
          <Alert tone="red">{t('invitationUnavailable')}</Alert>
        ) : (
          <>
            <p className="text-lg font-semibold">{data.invitation.groupName}</p>
            <p className="text-sm text-stone-600">{data.invitation.invitedName} · {t('invitationInfo')}</p>
            {user ? (
              <>
                <p className="text-sm text-stone-600">{user.fullName}</p>
                <ErrorText error={accept.error} />
                <button className="btn-primary w-full" disabled={accept.busy} onClick={() => accept.run(async () => {
                  const result = await api.post<{ groupId: string }>(`/invitations/${encodeURIComponent(token)}/accept`);
                  nav(`/groups/${result.groupId}`, { replace: true });
                })}>{t('acceptInvite')}</button>
              </>
            ) : (
              <>
                <p className="text-sm text-stone-600">{t('loginToAccept')}</p>
                <div className="flex flex-wrap gap-2">
                  <Link className="btn-primary flex-1 text-center" to="/login" state={{ from: returnTo }}>{t('login')}</Link>
                  <Link className="btn-secondary flex-1 text-center" to="/register" state={{ from: returnTo }}>{t('register')}</Link>
                </div>
              </>
            )}
          </>
        )}
        {error && <p className="sr-only" role="alert">{error.message}</p>}
      </section>
    </div>
  );
}
