import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ScanLine, Users } from 'lucide-react';
import { useApi } from '../app/context';
import { qk } from '../api/hooks';
import { Page } from '../components/layout/Page';
import { IconTile, Row, Section } from '../components/ui/List';
import { useToast } from '../components/ui/Overlays';
import { OrgForm } from './OrgForm';
import { canManage, orgKey, useOrg } from './shared';

export default function OrgSettings() {
  const { org, refetch } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const manage = canManage(org.role);

  return (
    <Page title="Innstillinger" large>
      <div className="mx-4">
        <Section>
          <Row
            icon={
              <IconTile color="#30B0C7">
                <Users />
              </IconTile>
            }
            title="Team og roller"
            to={`/arrangor/${org.id}/team`}
          />
          <Row
            icon={
              <IconTile color="#5856D6">
                <ScanLine />
              </IconTile>
            }
            title="Skann billetter"
            to="/skann"
          />
          {org.status === 'approved' && (
            <Row
              icon={
                <IconTile color="#8E8E93">
                  <ExternalLink />
                </IconTile>
              }
              title="Se arrangørsiden"
              subtitle="Slik ser kjøperne dere"
              to={`/a/${org.slug}`}
            />
          )}
        </Section>
      </div>
      {manage ? (
        <OrgForm
          initial={{
            name: org.name,
            type: org.type,
            orgNumber: org.orgNumber ?? '',
            description: org.description,
            city: org.city ?? '',
            email: org.email,
            phone: org.phone ?? '',
            website: org.website ?? '',
            payoutAccount: org.payoutAccount ?? '',
            palette: org.palette,
            logoImageId: org.logoImageId,
          }}
          submitLabel="Lagre endringer"
          onSubmit={async (body) => {
            await api.put(`/org/${org.id}`, body);
            await qc.invalidateQueries({ queryKey: orgKey(org.id) });
            await qc.invalidateQueries({ queryKey: qk.me });
            refetch();
            toast({ message: 'Endringene er lagret', tone: 'success' });
          }}
        />
      ) : (
        <p className="mx-6 text-subhead text-label-2">Bare eiere og administratorer kan endre arrangørprofilen.</p>
      )}
    </Page>
  );
}
