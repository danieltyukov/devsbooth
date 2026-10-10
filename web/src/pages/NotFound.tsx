import { ButtonLink } from '../components/Button';
import { FullPageMessage } from '../components/FullPageMessage';

export function NotFound() {
  return (
    <FullPageMessage title="Nothing here" actions={<ButtonLink to="/">Go to DevsBooth</ButtonLink>}>
      The page you are looking for does not exist. Check the link, or start from the rooms list.
    </FullPageMessage>
  );
}
