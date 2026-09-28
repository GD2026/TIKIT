import { Compass } from 'lucide-react';
import { Page } from '../components/layout/Page';
import { EmptyState } from '../components/ui/Feedback';
import { LinkButton } from '../components/ui/Button';

export default function NotFound() {
  return (
    <Page title="Fant ikke siden" back="/">
      <EmptyState
        icon={<Compass />}
        title="Denne siden finnes ikke"
        message="Lenken kan være skrevet feil, eller siden er flyttet."
        action={<LinkButton to="/">Til forsiden</LinkButton>}
      />
    </Page>
  );
}
