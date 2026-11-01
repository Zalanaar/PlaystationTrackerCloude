import { SkRoot } from '@/ui/skeletons';

export default function Loading() {
  return (
    <SkRoot className="ps-health">
      <span className="ps-skeleton ps-health__sk" />
      <span className="ps-skeleton ps-health__sk" />
    </SkRoot>
  );
}
