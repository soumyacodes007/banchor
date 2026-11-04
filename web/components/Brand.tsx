import Link from "next/link";
import Image from "next/image";
export function Brand({ small }: { small?: boolean }) {
  return (
    <Link href="/" className="brand-link">
      <Image src="/icon.png" alt="" width={small ? 28 : 36} height={small ? 28 : 36} className="logo" />
      <span className={small ? "wordmark sm" : "wordmark"}>BANCHOR</span>
    </Link>
  );
}
export function Footer() {
  return <footer className="foot"><span className="checks" /><span className="rule" />BANCHOR — 2026</footer>;
}
