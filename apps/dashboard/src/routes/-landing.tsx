import { useRef, useState } from "react";
import type React from "react";
import { useNavigate } from "@tanstack/react-router";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import {
  ArrowRight,
  Check,
  FileCheck2,
  GitBranch,
  Layers3,
  Library,
  PackageCheck,
  Play,
  RadioTower,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useAuth } from "../app/auth.tsx";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";

gsap.registerPlugin(useGSAP, ScrollTrigger);

type ProductProofScene =
  | "cockpit"
  | "radar"
  | "identity"
  | "quality"
  | "library"
  | "publish"
  | "package";

const trustedTerms = [
  "Identity",
  "SourceSet",
  "Generation",
  "Run stages",
  "ContentPackage",
  "PublishNode",
];

const bentoCards = [
  {
    title: "Signals become editorial judgment",
    detail:
      "Source freshness, trend clustering, audience fit and skip reasons stay inside the run, not scattered across pages.",
    className: "lg:col-span-7 lg:row-span-2",
    scene: "radar",
    icon: RadioTower,
  },
  {
    title: "Drafts respect the identity",
    detail:
      "One trend can become four distinct angles because identity is separated from the publish destination.",
    className: "lg:col-span-5 lg:row-span-2",
    scene: "identity",
    icon: Layers3,
  },
  {
    title: "Guardrails before publishing",
    detail:
      "Fact risk, title strength, structure quality and package readiness are visible before any node publishes.",
    className: "lg:col-span-4 lg:row-span-2",
    scene: "quality",
    icon: ShieldCheck,
  },
  {
    title: "Every run leaves a trail",
    detail:
      "HTML, JSON, images, node attempts and learning notes are searchable after the package is generated.",
    className: "lg:col-span-4 lg:row-span-2",
    scene: "library",
    icon: Library,
  },
  {
    title: "Operators keep momentum",
    detail:
      "Platform drafts, matrix runs and node retries are designed as daily actions, not hidden admin chores.",
    className: "lg:col-span-4 lg:row-span-2",
    scene: "publish",
    icon: Workflow,
  },
] satisfies {
  title: string;
  detail: string;
  className: string;
  scene: ProductProofScene;
  icon: typeof RadioTower;
}[];

const storyCards = [
  {
    title: "Sources watch the market while you keep taste.",
    detail:
      "Providers, source health and candidate topics are ranked into a usable editorial queue.",
    scene: "radar",
  },
  {
    title: "Topics stay inside the run where decisions belong.",
    detail:
      "The product remembers why a theme was chosen, delayed or rejected, so judgment compounds.",
    scene: "package",
  },
  {
    title: "One signal can become identity-aware variants.",
    detail:
      "Profiles, templates, model settings and image options are progressive instead of overwhelming.",
    scene: "identity",
  },
  {
    title: "Quality review protects packages before publishing pressure wins.",
    detail:
      "Scores, revision suggestions, learning notes and artifact previews form a real publishing gate.",
    scene: "quality",
  },
] satisfies {
  title: string;
  detail: string;
  scene: ProductProofScene;
}[];

const galleryCards = [
  {
    title: "Hero product in action",
    detail: "Today's cockpit shows next action, latest package and publish readiness.",
    scene: "cockpit",
  },
  {
    title: "Trend radar to topic decision",
    detail: "Source freshness and editorial decisions stay inside a single run.",
    scene: "radar",
  },
  {
    title: "Matrix identity generation",
    detail: "One signal becomes identity-aware drafts without mixing publish nodes.",
    scene: "identity",
  },
  {
    title: "Quality and publish guardrails",
    detail: "The package is frozen before preview, approval or external delivery.",
    scene: "quality",
  },
  {
    title: "Artifact library preview",
    detail: "HTML, JSON, images and publish attempts remain scoped to the selected run.",
    scene: "library",
  },
] satisfies {
  title: string;
  detail: string;
  scene: ProductProofScene;
}[];

const scrubText =
  "TrendPublish turns the messy middle of AI content operations into one precise product loop: source, decide, create, review, package, publish and learn. It feels like a creator workspace because the interface is built around momentum, taste and confidence instead of configuration sprawl.";

export function LandingPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLElement>(null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");

  useGSAP(
    () => {
      const prefersReducedMotion =
        globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      if (prefersReducedMotion) return;

      const intro = gsap.timeline({
        defaults: { ease: "power3.out", duration: 0.78 },
      });
      intro
        .from(".taste-nav", { autoAlpha: 0, y: -18 }, 0)
        .from(".hero-kicker", { autoAlpha: 0, y: 18 }, 0.12)
        .from(".hero-title", { autoAlpha: 0, y: 28 }, 0.22)
        .from(".hero-copy", { autoAlpha: 0, y: 20 }, 0.42)
        .from(".hero-access", { autoAlpha: 0, y: 18 }, 0.56)
        .from(
          ".hero-product",
          {
            autoAlpha: 0,
            y: 44,
            scale: 0.94,
            duration: 0.9,
            ease: "expo.out",
          },
          0.5,
        );

      gsap.to(".marquee-track", {
        xPercent: -50,
        duration: 26,
        ease: "none",
        repeat: -1,
      });

      gsap.from(".bento-card", {
        autoAlpha: 0,
        y: 42,
        scale: 0.96,
        stagger: 0.08,
        duration: 0.7,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".bento-grid",
          start: "top 78%",
        },
      });

      gsap.from(".gallery-card", {
        autoAlpha: 0,
        y: 44,
        scale: 0.96,
        stagger: 0.06,
        duration: 0.72,
        ease: "power3.out",
        scrollTrigger: {
          trigger: ".launch-gallery",
          start: "top 78%",
        },
      });

      gsap.fromTo(
        ".scrub-word",
        { opacity: 0.12, y: 10 },
        {
          opacity: 1,
          y: 0,
          stagger: 0.018,
          ease: "none",
          scrollTrigger: {
            trigger: ".scrub-copy",
            start: "top 82%",
            end: "bottom 42%",
            scrub: true,
          },
        },
      );

      gsap.utils.toArray<HTMLElement>(".media-reveal").forEach((item) => {
        gsap.fromTo(
          item,
          { scale: 0.84, opacity: 0.42 },
          {
            scale: 1,
            opacity: 1,
            ease: "none",
            scrollTrigger: {
              trigger: item,
              start: "top 86%",
              end: "bottom 24%",
              scrub: true,
            },
          },
        );
      });

      const media = gsap.matchMedia();
      media.add("(min-width: 1024px)", () => {
        ScrollTrigger.create({
          trigger: ".pin-story",
          start: "top top",
          end: "bottom bottom",
          pin: ".pin-copy",
          pinSpacing: false,
        });

        gsap.utils.toArray<HTMLElement>(".stack-card").forEach((card, index) => {
          gsap.fromTo(
            card,
            { y: 90, scale: 0.94 },
            {
              y: index * -18,
              scale: 1 - index * 0.018,
              ease: "none",
              scrollTrigger: {
                trigger: card,
                start: "top bottom-=80",
                end: "top top+=180",
                scrub: true,
              },
            },
          );
        });
      });

      return () => media.revert();
    },
    { scope: rootRef },
  );

  const submit = () => {
    if (isAuthenticated) {
      void navigate({ to: "/workspace" });
      return;
    }
    if (!apiKey.trim()) {
      setError("请输入 API key。");
      document
        .querySelector<HTMLInputElement>("#landing-api-key, #landing-api-key-footer")
        ?.focus();
      return;
    }
    login(apiKey);
    void navigate({ to: "/workspace" });
  };

  const scrollToWorkflow = () => {
    document.getElementById("workflow")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <main
      ref={rootRef}
      className="taste-landing w-full max-w-full overflow-x-hidden bg-[#080807] text-white"
    >
      <section
        className="relative min-h-dvh overflow-hidden bg-cover bg-center"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(8,8,7,0.08), rgba(8,8,7,0.92) 58%, #080807), linear-gradient(120deg, #111111 0%, #1f1a16 42%, #080807 100%)",
        }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,transparent_0,rgba(8,8,7,0.24)_34%,rgba(8,8,7,0.9)_100%)]" />
        <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,rgba(255,255,255,0.22)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:72px_72px]" />

        <div className="relative z-10 mx-auto flex min-h-dvh max-w-[1500px] flex-col px-5 py-5 md:px-8">
          <nav className="taste-nav mx-auto flex min-h-14 w-full max-w-5xl items-center justify-between rounded-full border border-white/14 bg-white/10 px-4 text-white shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
            <button
              type="button"
              className="text-left"
              onClick={() => globalThis.scrollTo({ top: 0, behavior: "smooth" })}
            >
              <span className="block text-xs font-black uppercase text-white/58">TrendPublish</span>
              <span className="block text-sm font-black">Creator OS</span>
            </button>
            <div className="hidden items-center gap-6 text-sm font-semibold text-white/70 md:flex">
              <a className="transition hover:text-white" href="#interest">
                Workflow
              </a>
              <a className="transition hover:text-white" href="#gallery">
                Gallery
              </a>
              <a className="transition hover:text-white" href="#workflow">
                Review
              </a>
              <a className="transition hover:text-white" href="#access">
                Access
              </a>
            </div>
            <button
              type="button"
              className="min-h-11 rounded-full bg-white px-4 text-sm font-black text-[#111] transition-colors"
              onClick={() => (isAuthenticated ? void navigate({ to: "/workspace" }) : submit())}
            >
              Workspace
            </button>
          </nav>

          <div className="relative z-10 flex flex-1 flex-col items-center justify-center pb-44 pt-16 text-center md:pb-56 md:pt-20">
            <p className="hero-kicker max-w-3xl text-sm font-semibold uppercase tracking-[0.28em] text-white/62">
              An AI trend publishing operating system
            </p>
            <h1 className="hero-title mx-auto mt-7 max-w-6xl text-[clamp(2.5rem,7vw,6rem)] font-black leading-[0.92] tracking-normal text-white">
              Turn AI trends{" "}
              <span
                aria-hidden="true"
                className="mx-3 hidden h-[0.56em] w-[1.26em] overflow-hidden rounded-full border border-white/24 bg-white/12 align-middle shadow-[0_0_0_1px_rgba(255,255,255,0.22)_inset] sm:inline-flex"
              >
                <span className="h-full w-[34%] bg-[#f15a24]" />
                <span className="h-full w-[28%] bg-white/72" />
                <span className="h-full flex-1 bg-[#7dd3a3]" />
              </span>{" "}
              into publish-ready content
            </h1>
            <p className="hero-copy mt-7 max-w-3xl text-base leading-8 text-white/74 md:text-xl md:leading-9">
              Scan the market, choose the angle, generate identity-aware drafts, review quality and
              keep every artifact inside one creator-grade workspace.
            </p>

            <div className="hero-access mt-9 w-full max-w-3xl">
              <label className="sr-only" htmlFor="landing-api-key">
                Server API key
              </label>
              {!isAuthenticated && (
                <Input
                  id="landing-api-key"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Paste your server API key"
                  value={apiKey}
                  className="border-white/18 bg-white/92 text-[#111] placeholder:text-[#57534e]"
                  onChange={(event) => {
                    setApiKey(event.currentTarget.value);
                    setError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                  }}
                />
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Button
                  size="lg"
                  className="min-h-12 rounded-full bg-white text-[#111] hover:bg-white/90"
                  onClick={submit}
                >
                  {isAuthenticated ? "Open workspace" : "Enter workspace"}
                  <ArrowRight className="size-5" />
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="secondary"
                  className="min-h-12 rounded-full border-white/28 bg-white/12 text-white hover:bg-white hover:text-[#111]"
                  onClick={scrollToWorkflow}
                >
                  Watch workflow
                  <Play className="size-5" />
                </Button>
              </div>
              {error && <p className="mt-3 text-sm font-semibold text-[#ffd0bd]">{error}</p>}
            </div>
          </div>
          <HeroProductPreview floating />
        </div>
      </section>

      <section className="overflow-hidden border-y border-white/12 bg-[#080807] py-6 text-white">
        <div className="marquee-track flex w-max gap-4">
          {[...trustedTerms, ...trustedTerms].map((term, index) => (
            <span
              key={`${term}-${index}`}
              className="rounded-full border border-white/12 bg-white/[0.055] px-6 py-3 text-lg font-black uppercase text-white/50"
            >
              {term}
            </span>
          ))}
        </div>
      </section>

      <section id="interest" className="bg-[#f5f1e8] px-5 py-32 text-[#111] md:px-8 md:py-48">
        <div className="mx-auto max-w-[1500px]">
          <div className="grid gap-8 lg:grid-cols-[1fr_0.72fr] lg:items-end">
            <h2 className="max-w-6xl text-[clamp(2.6rem,4.7vw,5.1rem)] font-black leading-[0.96] tracking-normal">
              Make the next publishing move obvious.
            </h2>
            <p className="max-w-2xl text-lg leading-8 text-[#4f4a43]">
              TrendPublish is a daily cockpit for creators and operators who need speed without
              losing editorial taste.
            </p>
          </div>

          <div className="bento-grid mt-16 grid grid-flow-dense gap-4 lg:grid-cols-12 lg:auto-rows-[190px]">
            {bentoCards.map((card) => {
              const Icon = card.icon;
              return (
                <article
                  key={card.title}
                  className={`bento-card group relative overflow-hidden rounded-[28px] border border-[#111]/12 bg-white p-6 shadow-[0_28px_90px_rgba(17,17,17,0.1)] ${card.className}`}
                >
                  <div className="absolute inset-0 opacity-70 transition-transform duration-700 ease-out group-hover:scale-[1.03]">
                    <ProductProofBackdrop scene={card.scene} />
                  </div>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(241,90,36,0.16),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.96))]" />
                  <div className="relative flex h-full flex-col justify-between">
                    <Icon className="size-8 text-[#f15a24]" />
                    <div>
                      <h3 className="max-w-xl text-3xl font-black leading-tight">{card.title}</h3>
                      <p className="mt-4 max-w-xl text-sm leading-6 text-[#4f4a43] md:text-base md:leading-7">
                        {card.detail}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="gallery"
        className="launch-gallery bg-[#111] px-5 py-32 text-white md:px-8 md:py-48"
      >
        <div className="mx-auto max-w-[1500px]">
          <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
            <h2 className="max-w-5xl text-[clamp(2.6rem,5vw,5.4rem)] font-black leading-[0.96] tracking-normal">
              Five launch frames that show the product, not promises.
            </h2>
            <p className="max-w-2xl text-lg leading-8 text-white/66">
              Each frame maps to a real creator workflow moment: cockpit, radar, identity matrix,
              quality guardrails and run-scoped artifact proof.
            </p>
          </div>

          <div className="mt-16 grid gap-4 lg:grid-cols-10">
            {galleryCards.map((card, index) => (
              <article
                key={card.title}
                className={[
                  "gallery-card group overflow-hidden rounded-[30px] border border-white/12 bg-white/[0.07] p-4 shadow-[0_34px_130px_rgba(0,0,0,0.38)]",
                  index === 0 ? "lg:col-span-6 lg:row-span-2" : "lg:col-span-4",
                ].join(" ")}
              >
                <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#f8f4eb]">
                  <ProductProofFrame scene={card.scene} />
                </div>
                <div className="grid gap-3 p-3 md:grid-cols-[1fr_0.82fr] md:p-5">
                  <h3 className="text-2xl font-black leading-tight">{card.title}</h3>
                  <p className="text-sm leading-6 text-white/62">{card.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="workflow"
        className="pin-story bg-[#080807] px-5 py-32 text-white md:px-8 md:py-48"
      >
        <div className="mx-auto grid max-w-[1500px] gap-16 lg:grid-cols-[0.78fr_1.22fr]">
          <div className="pin-copy self-start lg:min-h-dvh lg:pt-10">
            <h2 className="max-w-3xl text-[clamp(2.5rem,5.7vw,5.8rem)] font-black leading-[0.95] tracking-normal">
              One loop from signal to shipped artifact.
            </h2>
            <p className="scrub-copy mt-8 max-w-2xl text-lg leading-8 text-white/72 md:text-xl md:leading-9">
              {scrubText.split(" ").map((word, index) => (
                <span key={`${word}-${index}`} className="scrub-word inline-block">
                  {word}
                  {index < scrubText.split(" ").length - 1 ? "\u00a0" : ""}
                </span>
              ))}
            </p>
          </div>

          <div className="stack-list grid gap-8">
            {storyCards.map((card) => (
              <article
                key={card.title}
                className="stack-card group overflow-hidden rounded-[32px] border border-white/12 bg-white/[0.06] p-4 shadow-[0_32px_120px_rgba(0,0,0,0.42)] backdrop-blur"
              >
                <div className="media-reveal overflow-hidden rounded-[24px]">
                  <ProductProofFrame scene={card.scene} dark />
                </div>
                <div className="grid gap-4 p-4 md:grid-cols-[1fr_0.78fr] md:p-6">
                  <h3 className="text-3xl font-black leading-tight">{card.title}</h3>
                  <p className="text-sm leading-6 text-white/64 md:text-base md:leading-7">
                    {card.detail}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="access" className="bg-[#f5f1e8] px-5 py-32 text-[#111] md:px-8 md:py-48">
        <div className="mx-auto max-w-[1500px] overflow-hidden rounded-[36px] bg-[#111] p-6 text-white shadow-[0_32px_120px_rgba(17,17,17,0.22)] md:p-12">
          <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
            <div>
              <h2 className="max-w-5xl text-[clamp(2.6rem,6vw,6.2rem)] font-black leading-[0.92] tracking-normal">
                Build the daily habit around judgment, not prompts.
              </h2>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-white/68">
                Use your existing server key and move straight into the rebuilt creator workspace.
                The backend workflow stays intact; the product experience becomes worth returning
                to.
              </p>
            </div>
            <div className="rounded-[28px] border border-white/14 bg-white/[0.07] p-4">
              {!isAuthenticated && (
                <Input
                  id="landing-api-key-footer"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Server API key"
                  value={apiKey}
                  className="border-white/18 bg-white text-[#111]"
                  onChange={(event) => {
                    setApiKey(event.currentTarget.value);
                    setError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                  }}
                />
              )}
              <Button
                size="lg"
                className="mt-3 min-h-12 w-full rounded-full bg-white text-[#111] hover:bg-white/90"
                onClick={submit}
              >
                {isAuthenticated ? "Open workspace" : "Enter workspace"}
                <ArrowRight className="size-5" />
              </Button>
              <div className="mt-5 grid gap-3 text-sm text-white/64">
                {[
                  "Dashboard routes stay deep-linkable",
                  "Cloudflare dashboard fallback remains intact",
                  "Electron-ready adapter boundary preserved",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-[#7dd3a3]" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <footer className="mt-20 flex flex-col gap-4 border-t border-white/12 pt-6 text-sm text-white/48 md:flex-row md:items-center md:justify-between">
            <span>TrendPublish Creator OS</span>
            <span>Identities - Sources - Runs - Publishing - Library</span>
          </footer>
        </div>
      </section>
    </main>
  );
}

function ProductProofBackdrop({ scene }: { scene: ProductProofScene }) {
  return (
    <div className="h-full w-full scale-110 opacity-80 blur-[0.2px]">
      <ProductProofFrame scene={scene} compact />
    </div>
  );
}

function ProductProofFrame({
  scene,
  compact = false,
  dark = false,
}: {
  scene: ProductProofScene;
  compact?: boolean;
  dark?: boolean;
}) {
  const shellTone = dark
    ? "border-white/10 bg-[#0f0f0d] text-white"
    : "border-[#111]/10 bg-[#f8f4eb] text-[#111]";
  const headerTone = dark ? "border-white/10 bg-white/[0.06]" : "border-[#111]/10 bg-white";
  return (
    <div
      className={[
        "relative aspect-[16/9] overflow-hidden transition-transform duration-700 ease-out group-hover:scale-[1.025]",
        compact ? "min-h-full" : "",
        shellTone,
      ].join(" ")}
    >
      <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:46px_46px]" />
      <div className="relative grid h-full grid-rows-[48px_minmax(0,1fr)]">
        <div className={["flex items-center justify-between border-b px-4", headerTone].join(" ")}>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#c83232]" />
            <span className="size-2 rounded-full bg-[#d99a28]" />
            <span className="size-2 rounded-full bg-[#137a4a]" />
          </div>
          <div className="text-[10px] font-black uppercase text-current/48">
            {proofSceneTitle(scene)}
          </div>
          {proofSceneIcon(scene)}
        </div>
        <div className="min-h-0 p-3 md:p-4">
          {scene === "cockpit" && <CockpitProof dark={dark} />}
          {scene === "radar" && <RadarProof dark={dark} />}
          {scene === "identity" && <IdentityProof dark={dark} />}
          {scene === "quality" && <QualityProof dark={dark} />}
          {scene === "library" && <LibraryProof dark={dark} />}
          {scene === "publish" && <PublishProof dark={dark} />}
          {scene === "package" && <PackageProof dark={dark} />}
        </div>
      </div>
    </div>
  );
}

function CockpitProof({ dark }: { dark: boolean }) {
  return (
    <div className="grid h-full gap-3 md:grid-cols-[1.1fr_0.9fr]">
      <ProofPanel dark={dark} className="flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black">
            <Sparkles className="size-4 text-[#f15a24]" />
            Today's publishing cockpit
          </div>
          <p className="mt-2 text-xs leading-5 text-current/54">
            Next best action is generated from identity, source freshness and package readiness.
          </p>
        </div>
        <div className="grid gap-2">
          {[
            ["Run dry preview", "Ready"],
            ["Package handoff", "2 nodes"],
            ["Quality risk", "Low"],
          ].map(([label, value]) => (
            <ProofRow key={label} label={label} value={value} dark={dark} />
          ))}
        </div>
      </ProofPanel>
      <div className="grid gap-3">
        <ProofMetric label="Quality" value="87" dark={dark} />
        <ProofMetric label="Preview nodes" value="3" dark={dark} />
        <ProofPanel dark={dark}>
          <div className="text-xs font-black uppercase text-current/48">Launch path</div>
          <ProofStepper dark={dark} steps={["Identity", "Generation", "Package", "Preview"]} />
        </ProofPanel>
      </div>
    </div>
  );
}

function RadarProof({ dark }: { dark: boolean }) {
  return (
    <div className="grid h-full gap-3 md:grid-cols-[0.9fr_1.1fr]">
      <ProofPanel dark={dark}>
        <div className="flex items-center gap-2 text-sm font-black">
          <RadioTower className="size-4 text-[#f15a24]" />
          Source health
        </div>
        <div className="mt-4 grid gap-3">
          {[
            ["OpenAI", "92%"],
            ["Hacker News", "78%"],
            ["Arxiv", "64%"],
          ].map(([label, value], index) => (
            <div key={label}>
              <div className="flex justify-between text-xs font-bold text-current/58">
                <span>{label}</span>
                <span>{value}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-current/10">
                <div
                  className="h-full rounded-full bg-[#f15a24]"
                  style={{ width: `${92 - index * 14}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </ProofPanel>
      <ProofPanel dark={dark}>
        <div className="text-xs font-black uppercase text-current/48">Topic decision</div>
        <div className="mt-3 grid gap-2">
          {[
            ["AI browsers", "Adopt"],
            ["Agent memory", "Lock"],
            ["Model pricing", "Skip"],
          ].map(([label, value]) => (
            <ProofRow key={label} label={label} value={value} dark={dark} />
          ))}
        </div>
      </ProofPanel>
    </div>
  );
}

function IdentityProof({ dark }: { dark: boolean }) {
  return (
    <div className="grid h-full gap-3 md:grid-cols-3">
      {[
        ["Founder voice", "direct, practical", "92"],
        ["Lab voice", "dense, technical", "88"],
        ["Operator voice", "brief, tactical", "84"],
      ].map(([name, detail, score]) => (
        <ProofPanel key={name} dark={dark} className="flex flex-col">
          <div className="grid size-10 place-items-center rounded-2xl bg-[#f15a24] text-sm font-black text-white">
            {name.slice(0, 1)}
          </div>
          <div className="mt-auto">
            <div className="text-sm font-black">{name}</div>
            <div className="mt-1 text-xs text-current/54">{detail}</div>
            <div className="mt-4 text-3xl font-black">{score}</div>
          </div>
        </ProofPanel>
      ))}
    </div>
  );
}

function QualityProof({ dark }: { dark: boolean }) {
  return (
    <div className="grid h-full gap-3 md:grid-cols-[0.86fr_1.14fr]">
      <ProofPanel dark={dark} className="grid place-items-center text-center">
        <div>
          <ShieldCheck className="mx-auto size-8 text-[#137a4a]" />
          <div className="mt-4 text-6xl font-black leading-none">87</div>
          <div className="mt-2 text-xs font-bold uppercase text-current/48">Quality score</div>
        </div>
      </ProofPanel>
      <ProofPanel dark={dark}>
        <div className="text-sm font-black">Guardrails</div>
        <div className="mt-4 grid gap-2">
          {[
            ["Fact risk", "Low"],
            ["Title strength", "Repair suggested"],
            ["Package contract", "Ready"],
            ["External publish", "Needs confirmation"],
          ].map(([label, value]) => (
            <ProofRow key={label} label={label} value={value} dark={dark} />
          ))}
        </div>
      </ProofPanel>
    </div>
  );
}

function LibraryProof({ dark }: { dark: boolean }) {
  return (
    <div className="grid h-full gap-3 md:grid-cols-[1fr_0.78fr]">
      <ProofPanel dark={dark}>
        <div className="flex items-center gap-2 text-sm font-black">
          <Library className="size-4 text-[#f15a24]" />
          Run-scoped artifacts
        </div>
        <div className="mt-4 grid gap-2">
          {[
            ["preview.html", "HTML"],
            ["quality-review.json", "JSON"],
            ["cover.png", "Image"],
            ["publish-attempt.json", "Status"],
          ].map(([label, value]) => (
            <ProofRow key={label} label={label} value={value} dark={dark} />
          ))}
        </div>
      </ProofPanel>
      <ProofPanel dark={dark} className="flex flex-col justify-between">
        <PackageCheck className="size-7 text-[#137a4a]" />
        <div>
          <div className="text-2xl font-black">ContentPackage</div>
          <p className="mt-2 text-xs leading-5 text-current/54">
            Frozen context: body, media, identity, review and handoff contract.
          </p>
        </div>
      </ProofPanel>
    </div>
  );
}

function PublishProof({ dark }: { dark: boolean }) {
  return (
    <div className="grid h-full gap-3 md:grid-cols-[0.82fr_1.18fr]">
      <ProofPanel dark={dark}>
        <div className="flex items-center gap-2 text-sm font-black">
          <SendHorizontal className="size-4 text-[#f15a24]" />
          Publish nodes
        </div>
        <ProofStepper dark={dark} steps={["Preview", "Approval", "Weixin", "Webhook"]} />
      </ProofPanel>
      <ProofPanel dark={dark}>
        <div className="text-xs font-black uppercase text-current/48">Handoff result</div>
        <div className="mt-4 grid gap-2">
          {[
            ["Platform preview", "No external touch"],
            ["Approval inbox", "Human review"],
            ["Live delivery", "Explicit confirm"],
          ].map(([label, value]) => (
            <ProofRow key={label} label={label} value={value} dark={dark} />
          ))}
        </div>
      </ProofPanel>
    </div>
  );
}

function PackageProof({ dark }: { dark: boolean }) {
  return (
    <div className="grid h-full gap-3 md:grid-cols-[1fr_1fr]">
      <ProofPanel dark={dark}>
        <div className="flex items-center gap-2 text-sm font-black">
          <GitBranch className="size-4 text-[#f15a24]" />
          Run stages
        </div>
        <ProofStepper dark={dark} steps={["Prepare", "Brief", "Source", "Review", "Build"]} />
      </ProofPanel>
      <ProofPanel dark={dark}>
        <div className="text-sm font-black">Package contract</div>
        <p className="mt-3 text-xs leading-5 text-current/54">
          Publishing receives the whole package context, not a loose HTML file.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {["html", "json", "media", "review"].map((item) => (
            <span
              key={item}
              className="rounded-full bg-current/10 px-3 py-1 text-center text-[10px] font-black uppercase"
            >
              {item}
            </span>
          ))}
        </div>
      </ProofPanel>
    </div>
  );
}

function ProofPanel({
  dark,
  children,
  className = "",
}: {
  dark: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "min-w-0 rounded-[20px] border p-4",
        dark ? "border-white/10 bg-white/[0.06]" : "border-[#111]/10 bg-white",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function ProofRow({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return (
    <div
      className={[
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2 text-xs",
        dark ? "bg-white/[0.06]" : "bg-[#f5f1e8]",
      ].join(" ")}
    >
      <span className="min-w-0 truncate font-bold text-current/62">{label}</span>
      <span className="font-black">{value}</span>
    </div>
  );
}

function ProofMetric({ label, value, dark }: { label: string; value: string; dark: boolean }) {
  return (
    <ProofPanel dark={dark}>
      <div className="text-xs font-bold uppercase text-current/48">{label}</div>
      <div className="mt-1 text-4xl font-black leading-none">{value}</div>
    </ProofPanel>
  );
}

function ProofStepper({ steps, dark }: { steps: string[]; dark: boolean }) {
  return (
    <div className="mt-4 grid gap-2">
      {steps.map((step, index) => (
        <div key={step} className="flex items-center gap-2">
          <span
            className={[
              "grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-black",
              index === steps.length - 1
                ? "bg-[#137a4a] text-white"
                : dark
                  ? "bg-white/12 text-white/70"
                  : "bg-[#111]/10 text-[#111]/62",
            ].join(" ")}
          >
            {index + 1}
          </span>
          <span className="min-w-0 truncate text-xs font-bold text-current/62">{step}</span>
        </div>
      ))}
    </div>
  );
}

function proofSceneTitle(scene: ProductProofScene) {
  switch (scene) {
    case "cockpit":
      return "Workspace";
    case "radar":
      return "Trend radar";
    case "identity":
      return "Identity matrix";
    case "quality":
      return "Quality review";
    case "library":
      return "Artifact library";
    case "publish":
      return "Publish path";
    case "package":
      return "Run stages";
  }
}

function proofSceneIcon(scene: ProductProofScene) {
  const className = "size-5 text-current/50";
  switch (scene) {
    case "cockpit":
      return <Workflow className={className} />;
    case "radar":
      return <RadioTower className={className} />;
    case "identity":
      return <Layers3 className={className} />;
    case "quality":
      return <ShieldCheck className={className} />;
    case "library":
      return <Library className={className} />;
    case "publish":
      return <SendHorizontal className={className} />;
    case "package":
      return <PackageCheck className={className} />;
  }
}

function HeroProductPreview({ floating = false }: { floating?: boolean }) {
  return (
    <div
      className={`hero-product w-full max-w-6xl overflow-hidden rounded-[34px] border border-white/16 bg-white/[0.08] p-3 text-left shadow-[0_40px_160px_rgba(0,0,0,0.5)] backdrop-blur-xl ${
        floating
          ? "pointer-events-none absolute inset-x-5 bottom-[-250px] z-0 mx-auto hidden opacity-95 lg:block"
          : "mt-12 md:mt-16"
      }`}
    >
      <div className="overflow-hidden rounded-[26px] border border-white/12 bg-[#f8f4eb] text-[#111]">
        <div className="flex min-h-14 items-center justify-between border-b border-[#111]/10 bg-white px-4">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#c83232]" />
            <span className="size-2 rounded-full bg-[#d99a28]" />
            <span className="size-2 rounded-full bg-[#137a4a]" />
          </div>
          <div className="hidden text-xs font-black uppercase text-[#76716a] md:block">
            Today's publishing cockpit
          </div>
          <FileCheck2 className="size-5 text-[#137a4a]" />
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-[1.05fr_0.95fr] lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[22px] border border-[#111]/10 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-black">
              <Sparkles className="size-4 text-[#f15a24]" />
              AI infra shockwave
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e7e3d9]">
              <div className="h-full w-[82%] rounded-full bg-[#f15a24]" />
            </div>
            <div className="mt-5 grid gap-3">
              {[
                ["Radar", "18 sources scored"],
                ["Topic", "lead angle selected"],
                ["Source", "4 identity variants"],
                ["Review", "2 repairs suggested"],
              ].map(([title, detail]) => (
                <div
                  key={title}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#111]/10 pb-3 last:border-0 last:pb-0"
                >
                  <div>
                    <div className="text-sm font-black">{title}</div>
                    <div className="mt-1 text-xs text-[#4f4a43]">{detail}</div>
                  </div>
                  <Check className="size-4 text-[#137a4a]" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4">
            <div className="rounded-[22px] bg-[#111] p-5 text-white">
              <ShieldCheck className="size-5 text-[#7dd3a3]" />
              <h3 className="mt-10 text-3xl font-black leading-tight">
                Quality review before the source leaves the room.
              </h3>
              <p className="mt-4 text-sm leading-6 text-white/62">
                Review exposes fact risk, structure drift and weak title signals before publishing.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-[18px] border border-[#111]/10 bg-white p-4">
                <div className="text-xs font-bold text-[#76716a]">Quality</div>
                <div className="mt-1 text-3xl font-black">87</div>
              </div>
              <div className="rounded-[18px] border border-[#111]/10 bg-white p-4">
                <div className="text-xs font-bold text-[#76716a]">Identities</div>
                <div className="mt-1 text-3xl font-black">4</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
