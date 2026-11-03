import Link from 'next/link';

/** F3/D-P5: вход в «Ленту трофеев» из панели «Трофеи». */
export function FeedLink() {
  return <Link href="/trophies" className="ps-st-feedlink" data-testid="stats-feed-link">Вся лента трофеев →</Link>;
}
