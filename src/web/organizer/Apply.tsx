import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Organizer } from '../../shared/types';
import { useApi } from '../app/context';
import { useAuth } from '../app/auth';
import { qk } from '../api/hooks';
import { Page } from '../components/layout/Page';
import { RequireLogin } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';
import { OrgForm, emptyOrgValues } from './OrgForm';

function ApplyForm() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useAuth();
  return (
    <>
      <p className="mx-6 mb-5 text-subhead text-label-2">
        Fortell litt om dere. TIKIT godkjenner nye arrangører før første arrangement publiseres – vanligvis samme dag. I mellomtiden kan dere lage arrangementer og billetter.
      </p>
      <OrgForm
        initial={emptyOrgValues(me?.email ?? null)}
        submitLabel="Opprett arrangør"
        onSubmit={async (body) => {
          const org = await api.post<Organizer>('/org', body);
          await qc.invalidateQueries({ queryKey: qk.me });
          toast({ message: org.status === 'approved' ? 'Arrangøren er klar!' : 'Arrangøren er opprettet og venter på godkjenning', tone: 'success' });
          navigate(`/arrangor/${org.id}`, { replace: true });
        }}
      />
    </>
  );
}

export default function Apply() {
  return (
    <Page title="Ny arrangør" back="/arrangor">
      <RequireLogin reason="Logg inn for å opprette en arrangørkonto.">
        <ApplyForm />
      </RequireLogin>
    </Page>
  );
}
