# NumPay Funding Playbook

Last updated: 2026-06-25.
Status: Research synthesis. Not a commitment, not a decision document. Use as a map.

This document is fitted to what NumPay actually is right now, based on the project's own
`CLAUDE.md`, `NUMPAY_CC_KICKOFF.md`, `docs/ARCHITECTURE_DECISIONS.md`,
`docs/CHAIN_SUPPORT_MATRIX.md`, `docs/THREAT_MODEL.md`, and `NEXT_STEP.md`. Web research was
cross-checked against current grant programs, accelerators, comparable raises, and the 2026
market for crypto wallet and payments startups.

---

## 1. What NumPay is, in the eyes of an investor or grant reviewer

This shapes everything that follows. Be honest about it.

- **Product.** Non-custodial Manifest V3 wallet extension plus a payment identity layer. An
  11-digit Verhoeff-checksummed public alias resolves to wallet addresses across chains.
  Backend never holds keys.
- **Stage.** Pre-product. Phase 0 docs and threat model done. Phase 1 (Sepolia ETH and
  Solana devnet, full send and receive) not yet written. No mainnet, no users, no revenue.
- **Team signal.** Solo or small. CRITICAL_CODE mode and the depth of the threat model
  say "security-rigorous founder," which is a real signal. Most pre-seed crypto decks have
  nothing close to the existing `THREAT_MODEL.md` or `ARCHITECTURE_DECISIONS.md`.
- **Competitive frame.** Aliases-for-crypto is an old, scarred space (ENS, SNS, Coinbase
  usernames, Daimo handles, .eth subdomains). The differentiator has to be sharp. *Why
  does a backend-anchored 11-digit alias with TOFU pinning beat ENS or SNS for the user
  you target?* If that does not fit in one sentence, neither grants nor VCs will fund it.
- **Market backdrop.** Dragonfly's GP called 2026 a "mass extinction event" for blockchain
  VCs. Pure early-stage venture deals are shrinking. Capital is flowing to payments,
  stablecoin infra, and exchanges. That is tailwind for NumPay's category, but reviewers
  are pickier than they were in 2021 to 2022.

---

## 2. The funding ladder, ordered by what is realistic now

Sizes, terms, timing, and a verdict on whether to apply.

### Tier A. Non-dilutive. Apply this quarter.

| Source | Size | Terms | NumPay fit | Verdict |
|---|---|---|---|---|
| Solana Foundation Grants | Milestone-based, no fixed cap. Convertible-grant option lets them invest later. | Public-good or open-source contribution. Rolling intake. | High. SOL is a Phase 1 chain. Wallet UX is a stated priority area. | Apply |
| Ethereum Foundation ESP | $5K to $200K+ per grant. $148M+ deployed across 900+ projects since 2019. | Wishlists and RFPs format now. Outputs must be open-source or public-good. | High. Wallet UX, account abstraction, security are explicit ESP themes. | Apply |
| Stellar Community Fund (SCF v7) | Up to $150K in XLM. Four milestone tranches (10, 20, 30, 40%). | Must build something meaningful on Stellar. | Medium. Would force a Stellar implementation. Only worth it if XLM gets added as a Phase 2 chain anyway. | Skip unless adding XLM |
| Gitcoin Grants (GG24+) | Quadratic match from a ~$1.8M pool. Per-project typically low five figures. | Open-source. Community donations count toward the match. | Medium. Good for credibility and a small cash injection, not the main event. | Apply lightweight |
| Base Builder Grants | Average ~$2.5K. Very fast turnaround. | Build on Base or OP Stack. | Low for the cash itself, but it is a foot in Coinbase Ventures' door. | Apply if Base is on the roadmap |

Realistic combined haul if two or three land: $60K to $300K, non-dilutive, over 3 to 9 months.

### Tier B. Accelerators with a check. Apply next 1 to 2 quarters.

| Program | Check | Equity | Cadence | NumPay fit |
|---|---|---|---|---|
| Alliance | $500K (Alliance puts in ~$450K on founder-friendly terms) | "Skin-in-the-game" stake, undisclosed % | 3 cohorts per year. ALL18 starts Sept 7, 2026. ~2-week interview turnaround. | Strong. They explicitly fund crypto, stablecoins, payments, pre-product teams. Median portfolio company raises $3.5M at $25M post after the program. Best single bet. |
| a16z Crypto CSX | $500K for 7% | 12 weeks, in-person SF | 2 cohorts per year | High prestige, lower hit rate. Apply when next CSX cohort opens. Worth applying even when not "ready". The process surfaces signal. |
| Colosseum (via Solana Frontier Hackathon) | $250K pre-seed for top 10+ winners. $2.5M total pool. | Pre-seed terms, undisclosed | Next hackathon April to May 2026 already ran. Watch for the next one mid-2026. | Strong. Solana-aligned, payments-friendly, lower bar than a16z. The hackathon itself is the application. |
| Orange DAO Fellowship | $100K Fellowship. Up to $300K in the accelerator track. | 2% program fee on Fellowship | 12 weeks. Rolling. | Solid fit for early non-custodial wallet plays. Lower-prestige than Alliance but lower-bar too. |

### Tier C. Angels and pre-seed VCs. Only after a working extension.

- **Dragonfly.** Closed a $650M fourth fund in Feb 2026, focused on payments and stablecoin
  infra (Rain, Mesh, Ethena). Fits the thesis. Writes seed checks.
- **Multicoin, Variant, Hack VC, Coinbase Ventures, Haun Ventures.** Same story.
- **Solo angels writing $10K to $100K.** Target wallet and payments operators (ex-Phantom,
  ex-Coinbase Wallet, ex-Rainbow, ex-Daimo). These checks come on conviction. You need a
  demo and a story, not metrics.

Do not approach Tier C until you have: the extension installed locally with working alias
to address resolution, a signed Sepolia tx, and a signed devnet SOL tx, recorded as a
90-second Loom. That demo plus the existing docs is enough.

### Tier D. Africa-specific path. Only if Africa is the target.

A parallel route worth knowing if Nigeria or Africa is the target market:

- **Adaverse** (Cardano-aligned, 45+ portfolio companies, invested in Nestcoin's Onboard
  Wallet, a direct adjacent to NumPay).
- **Hashed Emergent** (led Nestcoin's recent $1.9M round).
- **Future Africa, Magic Fund, 4DX Ventures, Alter Global** (all in Nestcoin's cap table).
- **MEST Africa** accelerator.

If Africa is the target market, lead with that. None of the Tier A or B funders are
Africa-specialists. "Phone-number-like alias for crypto in regions with phone-first
onboarding habits" is a much sharper pitch than "alias for crypto" in general.

---

## 3. What grant reviewers and accelerators will actually ask

Based on what 2026 crypto pre-seed decks are getting funded on:

1. **What is the problem in one sentence, and why is it structural, not cosmetic?**
   "Crypto addresses are unmemorable" is cosmetic. "Phone-based payments are how 80% of
   [region X] sends money but on-chain has no analog" is structural.
2. **Why not ENS, SNS, or Daimo handles?** You need a real answer. Likely some combination
   of: numeric and language-neutral and IVR-compatible. Cheap or free to register because
   it is allocated, not auctioned. Cross-chain by design from day one. Does not require a
   domain mental model.
3. **Tokenomics or no token?** Do not propose a token in v1. "No token, pure utility,
   revenue model TBD" is a credible answer for non-custodial wallet infra. A half-baked
   tokenomics slide will get the deck declined.
4. **Regulatory posture.** Non-custodial is the shield. One sentence in the deck
   acknowledging MiCA, FinCEN, and local FX rules signals non-naive.
5. **On-chain traction is verifiable.** Once on mainnet, every daily active wallet, every
   signed payment intent, every binding registration is a metric. Do not go to angels
   before this exists.
6. **Open-source posture for grants.** ESP, Solana, Stellar, Gitcoin all require
   public-good output. Decide now whether the extension, web app, and protocol are
   Apache-2.0 or MIT. If yes, grants are open. If no, half of Tier A is closed.

---

## 4. Playbook. What to do, in order.

### Weeks 0 to 2 (now)

- Finish Phase 0 exit. Write the four `test-area/` scripts as the kickoff requires, run
  them, save real output.
- Decide on a license. Recommendation: Apache-2.0 for code, CC-BY-4.0 for docs. Keeps
  every grant door open.
- Write a one-pager: problem, NumPay, why-not-ENS, architecture in three bullets, ask.
  Reuse text from `CLAUDE.md` and `THREAT_MODEL.md`. The existing docs already do half
  the work.
- Write a 10-slide deck: problem, solution, demo placeholder, why-now, why-different,
  architecture and security (the strongest slide), team, traction plan, ask, contact.

### Weeks 2 to 6. Phase 1 to a demo.

- Build M1 to M3 from `docs/POC_PLAN.md` until: extension installs, generates a wallet,
  registers an alias, signs a Sepolia ETH transfer, signs a devnet SOL transfer.
- Record a 60 to 90 second Loom of the end-to-end flow. This is the single most leveraged
  artifact.

### Weeks 6 to 10. Grant applications in parallel.

- File a Solana Foundation grant. Angle: alias plus non-custodial extension, Phase 1 SOL
  focus.
- File an Ethereum Foundation ESP grant. Separate angle: TOFU-pinned alias resolution as
  a wallet UX primitive.
- Submit to the next Gitcoin Grants round.
- Pick one accelerator. Realistic recommendation: Alliance ALL18 (Sept 7 start). Apply by
  their Early Admission deadline. Backup: Orange DAO.
- If the Africa angle applies: warm intros to Adaverse and Hashed Emergent.

### Months 3 to 6. First cash lands. Optional angel round.

- If two grants hit at ~$100K combined, runway exists to push to mainnet.
- Mainnet beta plus first 100 real bindings is the threshold for angel conversations.
- Target: $250K to $500K pre-seed on SAFE, uncapped or $5M to $8M cap.

### Months 6 to 12. Seed round if metrics support it.

- 1,000+ active wallets, $X in payment intent volume, integrations with one or two dApps
  or merchants. That is the bar.
- Then talk to Dragonfly, Hack VC, Coinbase Ventures.

---

## 5. The honest risks

- **"Aliases for crypto" is a graveyard category.** ENS exists. SNS exists. Coinbase
  usernames exist. Daimo dropped phone handles in favor of pure stablecoin pay. NumPay
  needs a wedge: geographic, UX, or technical. Not just "ours is 11 digits."
- **You are compared directly to Daimo's $2M seed (2024) and Nestcoin's $8.35M total
  raised.** Reviewers will benchmark.
- **Solo-founder discount.** If solo, expect angels to push toward a technical co-founder
  before writing a check.
- **2026 funding is down 13% year over year.** Decisions are slower. Reviewers are
  stricter on traction. Plan on grants doing the heavy lifting until on-chain numbers
  exist.

---

## 6. Open questions to resolve before applying

1. Solo founder, or is there a team?
2. Target market: global, or a specific geography (Nigeria, Africa, LatAm, SEA)?
3. Open-source posture: Apache-2.0 or proprietary? Binary decision, changes the path.
4. Pitch artifact priority: the Solana Foundation grant narrative first, or the one-pager
   plus deck first?

---

## 7. Sources

- [Solana Foundation Grants and Funding](https://solana.org/grants-funding)
- [Solana Foundation convertible grants announcement](https://solana.com/news/solana-foundation-convertible-grants-investments)
- [Ethereum Foundation ESP, Applicants](https://esp.ethereum.foundation/applicants)
- [How to Apply for ESP, 2026 Builder Guide (GrantChain)](https://www.grantchain.eu/guides/how-to-apply-for-ethereum-foundation-esp)
- [Alliance Accelerator Apply page](https://alliance.xyz/apply)
- [Alliance Crypto and AI Accelerator 2026 profile](https://startupgrantshub.com/opportunities/alliance-crypto-ai-accelerator-2026/)
- [a16z Crypto Startup Accelerator (CSX)](https://a16zcrypto.com/accelerator/)
- [Apply to Join the CSX 04 Cohort, a16z crypto](https://a16zcrypto.com/posts/article/apply-to-join-the-csx-04-cohort-in-san-francisco-this-spring/)
- [Colosseum Hackathon overview](https://colosseum.com/hackathon)
- [Solana Frontier Hackathon announcement, Colosseum](https://blog.colosseum.com/announcing-the-solana-frontier-hackathon/)
- [Orange DAO Fellowship](https://www.orangedao.xyz/orange-fellowship)
- [Stellar Community Fund](https://communityfund.stellar.org/)
- [Stellar SCF v7 announcement](https://stellar.org/blog/ecosystem/introducing-scf-v7)
- [Base Ecosystem Fund, Gitcoin](https://gitcoin.co/apps/base-ecosystem-fund)
- [Base Builder Grants, Gitcoin](https://gitcoin.co/apps/base-builder-grants)
- [Arbitrum Grants](https://arbitrum.foundation/grants)
- [Gitcoin Grants 24](https://grants.gitcoin.co/)
- [Web3 Grant Programs for Early-Stage Builders 2026, Block AI](https://www.blockmm.ai/articles/db/web3-grant-programs-for-builders-2026)
- [Daimo, Crunchbase profile (Mar 2024 $2M seed)](https://www.crunchbase.com/organization/daimo)
- [Dragonfly closes $650M fourth fund, Fortune, Feb 2026](https://fortune.com/2026/02/17/dragonfly-fourth-fund-crypto-venture-capital-blockchain-polymarket-ethena/)
- [Adaverse invests in Nestcoin, Emurgo Africa](https://www.emurgo.africa/blog/posts/cardano-accelerator-adaverse-invests-in-nestcoin-to-catalyze-financial-inclusion-in-africa)
- [Nestcoin $1.9M funding, TechTrends Africa](https://techtrends.africa/nigerian-cryptocurrency-startup-nestcoin-secures-1-9-million-in-funding/)
- [Crypto Pitch Deck Guide 2026, Runway](https://www.runwayteam.co/post/crypto-pitch-deck)
