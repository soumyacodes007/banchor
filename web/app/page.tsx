"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand, Footer } from "@/components/Brand";
import { Dither } from "@/components/Dither";
import { SignIn } from "@/components/SignIn";
import { savedWallet } from "@/lib/wallet";

export default function Landing() {
  const router = useRouter();
  const [known, setKnown] = useState(false);
  useEffect(() => setKnown(!!savedWallet()), []);
  return (
    <main className="wrap">
      <header className="top">
        <Brand />
        {known ? <Link href="/dashboard" className="btn primary">Open dashboard →</Link> : <span className="pill blue">Monad testnet</span>}
      </header>

      <section className="hero">
        <Dither seed={11} px={4} tentacle={1} />
        <div className="copy">
          <h1><span>Meta profits from your attention.</span> <span>Take a cut.</span></h1>
          <p className="lead">Every scroll buys a sliver of the company that owns your feed.</p>
          <SignIn onDone={() => router.push("/dashboard?welcome=1")} />
        </div>
      </section>

      <section className="steps">
        <div className="card"><div className="label">01 · Sign in</div><h3>Touch ID, nothing else.</h3><p className="dim">Mera turns a passkey into your wallet. No seed phrase, no extension wallet.</p></div>
        <div className="card"><div className="label">02 · Top up</div><h3>$1,000 of test dollars.</h3><p className="dim">One tap on the faucet. On mainnet this becomes card or Apple Pay.</p></div>
        <div className="card"><div className="label">03 · Scroll</div><h3>Your feed pays you back.</h3><p className="dim">Instagram buys Meta, YouTube buys Alphabet. Highlight “Nvidia” to buy Nvidia.</p></div>
      </section>
      <Footer />
    </main>
  );
}
