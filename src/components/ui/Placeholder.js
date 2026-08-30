// Temporary placeholder screen content — replaced feature by feature.
import { Screen } from './Screen';
import { EmptyState } from './EmptyState';

export function Placeholder({ icon = '🚧', title = 'Under construction', subtitle = 'Ye feature agle update mein aa raha hai. Tab tak XP kamate raho! 💪', mode = 'light' }) {
  return (
    <Screen mode={mode} scroll={false}>
      <EmptyState icon={icon} title={title} subtitle={subtitle} mode={mode} />
    </Screen>
  );
}
