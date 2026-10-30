import { SkRoot } from '@/ui/skeletons';

export default function Loading() {
  return (
    <SkRoot className="ps-access">
      <span className="ps-skeleton ps-access__sk" />
      <span className="ps-skeleton ps-access__sk" />
    </SkRoot>
  );
}
