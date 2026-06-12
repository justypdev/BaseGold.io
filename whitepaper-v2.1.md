> ## ⚠️ DRAFT — NOT FOR PUBLICATION
> **This document is a working draft. Final copy and all whitepaper changes MUST go through Justin and attorney review BEFORE publish.** Inline `[CONFIRM-WITH-JUSTIN]` markers flag claims that could not be verified against the live site or current operations — each one must be confirmed or deleted during review. Remove this banner and all markers only after sign-off.
>
> **PUBLISH STEP — REQUIRED:** All sitewide whitepaper links (index.html, games.html, blog footers) point at `whitepaper.pdf`, which is still the **v2.0** file containing the old Golden Council governance copy. After sign-off, export the approved v2.1 to PDF and **overwrite `whitepaper.pdf`** with it in the same upload — otherwise the site (including the button already labeled “Download Whitepaper v2.1 (PDF)”) keeps serving the governance-framing v2.0 PDF.

---

# BaseGold: A Deflationary Digital Asset

### with Gamified Exchange and Autonomous Buyback Mechanisms

**BaseGold Foundation**
<https://basegold.io>

**Version 2.1 — June 2026**

Network: Base (Layer 2 Ethereum)  •  Ticker: BG  •  Total Supply: 10,000
Contract: `0x36b712A629095234F2196BbB000D1b96C12Ce78e`

**Revision History**

- **v2.1 — Golden Council restructured from governance body to holder benefits tier; governance references removed.** (June 2026)
- v2.0 — Initial public release. (February 2026)

---

## Abstract

A purely deflationary digital asset with a fixed supply of 10,000 tokens—rendering it 2,100 times scarcer than Bitcoin—is deployed on the Base Network, a Layer 2 Ethereum rollup developed by Coinbase. Unlike inflationary token models that dilute holder value through continuous emission, BaseGold employs an irreversible burn mechanism ensuring the circulating supply can only contract. We introduce MineSwap, a gamified decentralized exchange featuring an autonomous buyback-and-burn engine and a cashback rebate system that returns a portion of every trade fee directly to participants. The protocol further implements The Mine, an interactive mining application in which each participant receives a personalized ERC-721 NFT mine plot whose dynamic metadata records all gameplay activity, tournament results, and item acquisitions—creating a tradeable digital asset on OpenSea whose secondary market value appreciates with the depth of its holder's participation. All in-game purchases are executed through a buyback-and-burn shop, permanently removing BG tokens from circulation while enriching the buyer's NFT metadata. Mine plot data further determines eligibility for protocol airdrops and member recognition within the Golden Council, a token-gated holder benefits tier where a minimum holding of one BG confers membership. Network growth is incentivized through Gold Vein, a seven-tier referral structure with on-chain reward distribution. Every mechanism in the ecosystem is powered by trustless smart contracts audited to the latest security standards, ensuring deterministic execution with no centralized intermediary. Through this integrated architecture, trading activity, gameplay, and network expansion generate continuous deflationary pressure without requiring external intervention.

---

## 1. Introduction

The proliferation of digital assets has produced thousands of tokens, yet the vast majority lack meaningful scarcity mechanics. Bitcoin established the principle that a fixed supply creates an asymmetric demand curve: as adoption increases against a hard cap, per-unit value appreciates. BaseGold extends this thesis to its logical terminus—a supply three orders of magnitude smaller than Bitcoin's, combined with a deflationary burn mechanism that continuously reduces even that limited quantity.

However, scarcity alone is insufficient. A digital asset must also provide utility, liquidity, and an engaged holder community to sustain long-term holder confidence. BaseGold addresses these requirements through four integrated systems: MineSwap, a purpose-built decentralized exchange with autonomous buyback and cashback mechanisms; The Mine, an interactive gaming application that mints personalized NFT mine plots with dynamic metadata tradeable on OpenSea; Gold Vein, a multi-tier referral reward protocol; and the Golden Council, a token-gated holder benefits and recognition tier. Together, these systems form a self-reinforcing ecosystem where trading activity, gameplay, network growth, and supply contraction operate in concert.

This paper describes the technical architecture, economic mechanisms, liquidity strategy, and community structures that constitute the BaseGold protocol—including its deliberate backing against the strongest store-of-value assets in both the digital and traditional economies.

---

## 2. Design Principles

The BaseGold protocol is constructed around five foundational principles:

**Absolute Scarcity.** A total supply of 10,000 BG tokens is minted at contract deployment. No additional tokens can ever be created. This supply is 2,100 times smaller than Bitcoin's 21 million cap, establishing BaseGold as among the scarcest programmable assets in existence.

**Irreversible Deflation.** The ERC-20 burn function permanently removes tokens by transferring them to the zero address (0x000...dead). Every burn transaction is recorded on-chain, publicly verifiable, and mathematically irreversible. The supply trajectory is monotonically decreasing.

**Utility-Driven Value.** Rather than relying solely on speculative demand, BaseGold generates intrinsic utility through MineSwap's exchange infrastructure, cashback incentives, and referral rewards—creating organic reasons to hold and transact with BG tokens.

**Aligned Holder Community.** The Golden Council, a token-gated holder benefits tier requiring only one BG for membership, recognizes and rewards committed holders. This low threshold ensures broad participation while the token requirement ensures stakeholder alignment. The Council is a benefits tier — it does not control protocol parameters, fees, or treasury.

**Trustless Security.** Every mechanism in the BaseGold ecosystem—token burns, MineSwap fee distribution, cashback rebates, mine plot minting, shop purchases, and referral rewards—is powered by trustless smart contracts deployed on-chain. No centralized intermediary, custodian, or manual approval is required at any point in the transaction lifecycle. All contracts are built on OpenZeppelin's audited standard libraries and have been reviewed to the latest security standards, ensuring that the protocol operates exactly as specified in its published code with no possibility of unilateral alteration.

---

## 3. Token Economics

### 3.1 Supply Architecture

BaseGold is deployed as a standard ERC-20 token with ERC20Burnable and Ownable extensions, built on OpenZeppelin's audited contract library. The total supply of 10,000 BG was minted in a single transaction at contract creation. No mint function exists in the contract; this supply is permanent and immutable.

| Asset | Maximum Supply | Scarcity Ratio |
|---|---|---|
| Bitcoin (BTC) | 21,000,000 | 1× (baseline) |
| Ethereum (ETH) | ~120,000,000 | 0.17× |
| BaseGold (BG) | 10,000 | 2,100× |

*Table 1. Comparative supply analysis of major digital assets.*

### 3.2 Token Allocation

The initial distribution of 10,000 BG is structured to support long-term protocol development, ecosystem growth, and sustained liquidity. The allocation is designated across seven operational categories:

| Allocation Category | Amount (BG) | Percentage |
|---|---|---|
| MineSwap DEX Infrastructure & LPs | 2,400 | 24% |
| Web3 Technologies & Development | 1,600 | 16% |
| DeFi Lending Integration (Aave) | 1,200 | 12% |
| Exchange Partnerships & Listings | 1,000 | 10% |
| Innovation Team & Operations | 1,000 | 10% |
| Community Treasury & Airdrops | 800 | 8% |
| Liquidity Pools (Multi-DEX) | 2,000 | 20% |
| **Total Supply** | **10,000** | **100%** |

*Table 2. BaseGold token allocation by operational category.* `[CONFIRM-WITH-JUSTIN: allocation category renamed from "DAO Treasury & Airdrops" to "Community Treasury & Airdrops" as part of the Golden Council restructure — confirm the official name of this allocation going forward.]`

### 3.3 Deflationary Mechanism

The burn function is inherited from OpenZeppelin's ERC20Burnable contract. When invoked, it transfers the specified quantity of tokens to the zero address (0x0000000000000000000000000000000000000000), simultaneously reducing the totalSupply state variable. This operation is atomic, on-chain, and irreversible.

BaseGold is engineered with multiple independent deflationary pressure sources distributed across every contract in the ecosystem, ensuring that routine activity at any layer of the protocol contributes to permanent supply contraction:

**Voluntary Holder Burns.** Any BG holder may invoke the burn function directly, permanently destroying tokens from their own wallet. This allows individual participants to contribute to supply contraction at their discretion.

**MineSwap Autonomous Buyback-and-Burn.** A portion of every trading fee collected by MineSwap's Fee Distributor contract is used to autonomously purchase BG tokens on the open market and burn them. Higher trading volume generates larger fee accumulations, triggering more frequent burn cycles (described in detail in Section 4.3).

**Mine Plot Purchases.** The 0.10 BG cost to purchase a mine and mint a personalized NFT mine plot includes a burn component, removing tokens from circulation at the point of player onboarding.

**Mine Shop Purchases.** All BG tokens spent on upgrades, multipliers, and items in The Mine's integrated shop are permanently burned. Every in-game purchase—from the Golden Goat multiplier to cosmetic enhancements—triggers an on-chain burn transaction (described in Section 5.3).

**Gold Vein Referral Burns.** The Gold Vein referral reward system incorporates a burn allocation within its distribution mechanics, ensuring that network growth activity contributes to supply reduction alongside reward distribution.

The cumulative effect of these five independent burn vectors is a supply that contracts from every direction—through trading, gameplay, and network expansion. No single mechanism is relied upon in isolation; instead, the deflationary architecture is distributed across the entire protocol surface area, ensuring that any form of ecosystem participation contributes to increasing the scarcity of remaining tokens.

`[CONFIRM-WITH-JUSTIN: the former sixth mechanism, "Golden Council Protocol Burns" (burn events authorized through governance votes), has been removed because the Council no longer directs protocol activity. The updated index.html now advertises FIVE mechanisms, but the blog post "The 6 Burn Mechanisms That Make BaseGold Deflationary" currently retains a rebranded sixth mechanism, "scheduled protocol burns." Reconcile before publish: either (a) confirm a live, non-governance protocol-burn path exists and reinstate it here and on index.html as "Scheduled Protocol Burns," or (b) confirm five and sweep the blog post (title, URL slug, JSON-LD, OG image copy) down to five.]`

---

## 4. MineSwap: Gamified Decentralized Exchange

MineSwap is a purpose-built automated market maker (AMM) deployed as a five-contract architecture on Base Network. It serves as the native exchange for the BaseGold ecosystem while introducing two novel mechanisms to decentralized trading: an autonomous buyback-and-burn engine and a trader cashback rebate system.

### 4.1 Architecture

The MineSwap protocol consists of five interdependent smart contracts:

**Factory Contract.** Manages the creation and registry of all trading pair pools. Each pair is deployed as an independent liquidity pool contract following the constant product formula (x × y = k).

**Router Contract.** Provides the primary interface for swap execution, liquidity provisioning, and multi-hop routing. Handles slippage protection, deadline enforcement, and optimal path computation.

**Pair Contracts.** Individual liquidity pools holding token reserves. Each pair implements the AMM pricing curve and emits events for price oracle consumption.

**Fee Distributor Contract.** Receives the protocol's share of trading fees and autonomously allocates them between the buyback-and-burn engine and the cashback rebate pool according to a configurable split ratio.

**Rebate Contract.** Manages the trustless distribution of cashback rewards to qualifying traders. Claims are processed entirely on-chain through smart contract logic with no custodial intermediary, ensuring that earned rebates are always accessible and cannot be withheld or redirected.

### 4.2 Fee Structure and Distribution

Every swap executed on MineSwap incurs a total fee of 0.30%, split equally between two functions:

**Liquidity Provider Allocation (0.15%).** Distributed pro rata to liquidity providers of the relevant pair, incentivizing deep and stable liquidity across all markets.

**Protocol Allocation (0.15%).** Routed to the Fee Distributor contract, which partitions these funds between the buyback-and-burn engine and the trader cashback pool.

This dual-fee architecture ensures that trading activity simultaneously rewards liquidity provision and generates deflationary pressure—aligning the incentives of traders, liquidity providers, and long-term holders.

### 4.3 Autonomous Buyback-and-Burn Engine

The buyback-and-burn mechanism operates without manual intervention. When the protocol's accumulated fee balance exceeds a configurable threshold, the Fee Distributor automatically executes a market purchase of BG tokens through MineSwap's own liquidity pools, then invokes the burn function to permanently remove the acquired tokens from circulation.

This creates a direct link between trading volume and supply contraction: higher exchange activity generates larger fee accumulations, which trigger more frequent buyback-and-burn cycles. The mechanism transforms routine market activity into a persistent deflationary force.

### 4.4 Trader Cashback Rebate System

A portion of the protocol fee allocation is reserved for cashback rebates distributed to active traders. When a user executes a swap on MineSwap, a percentage of their protocol fee is credited to a claimable balance in the Rebate Contract. Users may claim accumulated rebates at any time through a single on-chain transaction.

The cashback system serves a dual purpose: it reduces effective trading costs for active participants, encouraging sustained volume, and it differentiates MineSwap from conventional DEXs that offer no direct fee benefit to traders. Rebate parameters are configurable at the contract level and may be adjusted by the protocol team to optimize for volume growth or deflationary intensity as market conditions evolve. `[CONFIRM-WITH-JUSTIN: parameter-adjustment authority is now attributed to the protocol team rather than the Golden Council — confirm this matches actual contract administration before publish.]`

### 4.5 Gamification Layer: The Mine

MineSwap integrates a competitive gamification system through The Mine, a community-driven click-to-mine tournament application that serves as both a user acquisition mechanism and a persistent value-generation engine for the BaseGold ecosystem. The Mine also functions as the central hub for BaseGold.io's community programs, airdrop distribution tools, and real-time leaderboard access—consolidating gameplay, Golden Council membership status, airdrop eligibility tracking, and competitive rankings into a single unified interface.

---

## 5. The Mine: Interactive Mining Application

The Mine is a competitive, season-based mining game in which participants accumulate mining scores through active gameplay. Purchasing a mine costs 0.10 BG, which mints the buyer's personalized NFT mine plot—a fully owned digital asset that the holder can sell on any NFT marketplace at any time, including OpenSea. This purchase establishes the foundational stake from which new players begin their progression toward accumulating one full BG token—the threshold for membership in the Golden Council, BaseGold's holder benefits tier. The Mine therefore functions as an onboarding pathway: participants who may not yet hold a full BG token are given a structured, gamified route to earn their way into the Golden Council through tournament prizes, airdrop eligibility, and ecosystem participation, all while building value in a tradeable NFT they own outright.

Each season operates as a discrete tournament with a defined prize pool denominated in BG tokens, distributed to top-performing miners at the season's conclusion. The application features a tiered progression system spanning 35+ levels, each with a unique title and escalating score thresholds, creating sustained engagement incentives across the full duration of each season.

Anti-cheat infrastructure, including automated detection of scripted inputs and behavioral anomaly analysis, ensures competitive integrity. The system is designed to reward genuine participation while maintaining a fair competitive environment for all players.

### 5.1 NFT Mine Plots: On-Chain Identity and Data Persistence

Upon entering The Mine, each participant is issued a personalized NFT representing their individual mine plot. This NFT functions as both a player identity credential and a persistent data container. All gameplay activity—including cumulative mining scores, level progression, seasonal tournament results, items purchased, upgrades applied, and historical performance metrics—is encoded directly into the NFT's metadata.

The mine plot NFT is minted as an ERC-721 token with dynamic metadata, meaning its on-chain attributes update in real time as the holder progresses through the game. This architecture ensures that every action a player takes is permanently recorded and publicly verifiable, transforming gameplay history into a tangible, ownable digital asset.

Each mine plot NFT also includes a personalized visual representation—a unique avatar and plot design generated for the holder—establishing individual identity within the BaseGold community and across external platforms.

### 5.2 Marketplace Integration and Value Accrual

Mine plot NFTs are fully compatible with the ERC-721 standard and are listed and tradeable on OpenSea, the largest NFT marketplace by volume. Because each plot's metadata contains a comprehensive record of its holder's cumulative gameplay achievements, high-performing plots accrue measurable secondary market value proportional to the effort and accomplishment they represent.

A mine plot with extensive level progression, multiple seasonal tournament placements, rare purchased items, and a long history of active participation carries demonstrably more value than a newly minted plot. This creates a direct economic link between time invested in the ecosystem and the resale value of the player's NFT—rewarding sustained engagement with appreciating asset value.

The metadata-as-value model also introduces a strategic dimension: players are incentivized to maximize the breadth and depth of their on-chain activity record, knowing that every level gained, every item acquired, and every tournament entered increases the market price their plot can command.

### 5.3 The Mine Shop: Buyback-and-Burn Commerce

The Mine features an integrated shop where players purchase exclusive upgrades and items using BG tokens. Available items include multiplier upgrades such as the Golden Goat (25× mining multiplier), cosmetic enhancements, and strategic tools that affect tournament performance. New items are introduced each season to maintain demand and novelty.

The economic mechanism underlying the shop is critical to BaseGold's deflationary architecture: all BG tokens spent in the shop are permanently burned through trustless smart contract execution. Every purchase triggers an atomic on-chain burn transaction, removing the spent tokens from circulation irreversibly with no manual intervention or administrative step required. This transforms in-game commerce into a direct supply contraction event—players enhance their competitive position while simultaneously increasing the scarcity of the asset they hold.

Furthermore, every item purchased through the shop is recorded in the buyer's mine plot NFT metadata. This means shop spending simultaneously accomplishes three objectives: it improves the player's in-game performance, it reduces the total BG supply through burning, and it increases the metadata richness—and therefore the secondary market value—of the player's NFT.

### 5.4 Airdrop Qualification and Golden Council Integration

Mine plot NFTs serve as qualification credentials for protocol airdrop events, which are distributed at the conclusion of each game season. The Community Treasury's 8% token allocation funds these seasonal airdrops to active ecosystem participants, with eligibility and allocation weighting determined by a composite score derived from five on-chain metrics recorded in each player's mine plot metadata:

**Number of Referrals.** Players who have driven network growth through Gold Vein referrals receive higher airdrop weighting, rewarding those who actively expand the BaseGold community.

**Amount of BG Burned.** Cumulative BG burned by the player—through shop purchases, voluntary burns, or other deflationary actions—is weighted as a direct measure of contribution to supply contraction.

**Amount of Gold Mined In-Game.** Total mining output across all seasons reflects sustained gameplay engagement and competitive participation within The Mine.

**Amount of BG Held in Wallet.** Current BG balance at the time of airdrop distribution rewards holders who maintain long-term positions, aligning airdrop incentives with token retention.

**Tournament Performance.** Seasonal leaderboard placement and level progression contribute additional weighting, recognizing competitive achievement within each season.

This multi-factor weighting model aligns airdrop distribution with genuine, measurable ecosystem contribution across every dimension of participation—network growth, deflationary activity, gameplay engagement, and long-term holding. By distributing airdrops at the end of each season, the protocol creates a recurring incentive cycle where players are motivated to maximize their composite score throughout the season's duration, knowing that every referral made, token burned, gold mined, and BG held directly increases their airdrop allocation.

Mine plot metadata also factors into Golden Council member recognition. While the minimum threshold for Council membership remains one BG token, airdrop weighting and seasonal ecosystem-drop priority incorporate plot-based reputation metrics that favor participants with demonstrated long-term commitment. This creates a meritocratic recognition layer where active contributors earn proportionally greater rewards and recognition, without excluding any token holder from membership.

### 5.5 Seasonal Tournament Structure

The Mine operates on a seasonal cadence, with each season introducing a fresh prize pool, new shop items, updated leaderboard competition, and thematic events. Seasonal resets create recurring engagement cycles while cumulative achievements persist in the mine plot NFT across all seasons, ensuring that long-term players continuously build value regardless of individual season outcomes.

Prize distribution follows a tiered structure rewarding the top performers of each season with BG tokens drawn from the designated prize pool. The combination of competitive rewards, persistent NFT value accrual, and airdrop qualification creates a multi-layered incentive architecture that sustains participation across successive seasons.

---

## 6. Gold Vein: Referral Reward Protocol

Gold Vein is a seven-tier referral reward system deployed as a verified smart contract on Base Network (Contract: `0x5E4842ac8D7b37922366cb1b78259b9324915dBC`). The protocol distributes 95% of every activation fee across seven levels of the referral chain, with the remaining 5% permanently burned—ensuring that every new participant who joins the ecosystem simultaneously rewards existing members and contributes to supply contraction.

### 6.1 Activation and Fee Distribution

When a new participant purchases a mine through Gold Vein, the 0.10 BG activation fee is split across the referral chain according to a fixed, on-chain distribution schedule. The referring member receives the largest share as a direct referral reward, while passive rewards flow upward through six additional tiers to earlier network participants. The distribution is executed atomically in a single transaction with no manual intermediary.

| Level | Type | Share of Fee | BG per Activation | Cumulative |
|---|---|---|---|---|
| Level 1 | Direct | 60% | 0.060 BG | 60% |
| Level 2 | Passive | 14% | 0.014 BG | 74% |
| Level 3 | Passive | 9% | 0.009 BG | 83% |
| Level 4 | Passive | 5% | 0.005 BG | 88% |
| Level 5 | Passive | 4% | 0.004 BG | 92% |
| Level 6 | Passive | 2% | 0.002 BG | 94% |
| Level 7 | Passive | 1% | 0.001 BG | 95% |
| Burn | Deflationary | 5% | 0.005 BG | 100% |

*Table 4. Gold Vein seven-tier reward distribution per 0.10 BG activation.*

### 6.2 Economic Design: 95% to Users, 5% Burned

The Gold Vein fee structure is designed to maximize participant incentives while maintaining deflationary integrity. Of every 0.10 BG activation fee, 0.095 BG (95%) is distributed directly to referral chain members, and 0.005 BG (5%) is sent to the burn address and permanently removed from circulation. There is no middleman, no platform fee, and no treasury allocation—the protocol operates purely as a peer-to-peer reward distribution mechanism with a built-in deflationary component.

The 60% direct referral reward at Level 1 creates a strong immediate incentive for active community building, while the six passive tiers (Levels 2–7) ensure that early adopters who helped establish the network continue to benefit from its growth over time. This dual-incentive structure rewards both active recruitment and the compounding network effects of a well-established referral chain.

### 6.3 On-Chain Transparency and User Dashboard

Every Gold Vein activation, referral relationship, and reward distribution is recorded on-chain and publicly verifiable through the verified smart contract on BaseScan. The Gold Vein application provides each activated user with a comprehensive dashboard displaying their referral tree across all seven levels, per-level earnings in BG with real-time USD conversion, total network size, and a shareable referral link and address for onboarding new participants.

An integrated earnings calculator allows prospective and existing users to model potential reward scenarios based on network growth projections, providing transparency into the protocol's reward mechanics before and after activation. The application also displays live BaseGold network statistics including current price, 24-hour volume, market capitalization, circulating supply, total tokens burned, and the real-time scarcity ratio versus Bitcoin.

---

## 7. DeFi Integration Strategy

### 7.1 Lending Protocol Integration

BaseGold is pursuing integration with established DeFi lending platforms, beginning with Aave, the largest decentralized lending protocol by total value locked. Listing BG as a supported collateral asset would enable holders to borrow against their positions without selling, accessing liquidity while maintaining exposure to the asset's deflationary trajectory.

The 12% token allocation designated for DeFi lending integration provides the liquidity depth and protocol incentives necessary to meet the listing requirements of major lending platforms and to seed initial borrowing markets.

### 7.2 Multi-DEX Liquidity and Store-of-Value Backing

BaseGold maintains active liquidity pools across seven decentralized exchanges on Base Network: Uniswap, SushiSwap, Aerodrome, PancakeSwap, Alienbase, SwapBased, and DackieSwap. This distributed liquidity architecture ensures price consistency through cross-venue arbitrage, minimizes single-venue dependency risk, and maximizes accessibility for traders across the Base ecosystem. MineSwap serves as the protocol's native exchange and the primary venue for BG trading activity.

A core element of BaseGold's liquidity strategy is the deliberate pairing of BG against the strongest store-of-value assets available on Base Network. Liquidity pools are provisioned against established digital assets including Ethereum (ETH), Bitcoin (BTC), Litecoin (LTC), and XRP—anchoring BaseGold's trading pairs to the most liquid and widely recognized assets in the digital economy. By maintaining deep liquidity against these foundational assets, BaseGold ensures that holders can enter and exit positions through trusted, high-capitalization trading pairs rather than relying on volatile or thinly traded intermediaries.

As the tokenized real-world asset (RWA) sector matures on Base Network, BaseGold intends to extend this store-of-value backing strategy to include tokenized representations of gold, silver, equities, and other commodities. The convergence of traditional store-of-value assets with BaseGold's extreme digital scarcity creates a unique positioning: BG becomes directly exchangeable not only against leading cryptocurrencies but also against the very real-world assets that have historically defined wealth preservation. This multi-asset liquidity framework reinforces BaseGold's thesis as a digital store of value by surrounding it with the strongest established stores of value across both digital and traditional asset classes.

---

## 8. The Golden Council: Holder Benefits Tier

The Golden Council is BaseGold's holder recognition and benefits tier, open to any wallet holding a minimum of one BG token. This threshold is deliberately low to maximize participation breadth, while the token holding requirement ensures that all members have direct economic alignment with the protocol's success. For participants entering the ecosystem by purchasing a mine at 0.10 BG, the path from mine owner to full Council member is an intentional design feature—creating a meritocratic progression from gameplay participant to recognized long-term holder.

Council membership is a benefits and recognition program. Members qualify for seasonal airdrops funded by the Community Treasury's 8% token allocation, with eligibility and weighting determined by the composite mine plot metadata score described in Section 5.4—giving the most active ecosystem participants priority for seasonal ecosystem drops. Membership status, airdrop eligibility tracking `[CONFIRM-WITH-JUSTIN: in-app airdrop eligibility tracking is not advertised anywhere on the prior site/docs — v2.0 says only that mine plot metadata determines airdrop weighting. Confirm The Mine actually displays airdrop eligibility, or delete this clause]`, and leaderboard access are consolidated in The Mine application's unified interface, so member benefits are as seamless and accessible as gameplay itself. Additional member benefits under consideration include early access to new ecosystem features `[CONFIRM-WITH-JUSTIN: early access is not currently advertised on the live site or delivered in any application — confirm this perk before publish, or delete this clause]` and holder-only community channels `[CONFIRM-WITH-JUSTIN: the Telegram links currently published are open public invites, not token-gated — confirm a holder-only channel actually exists before publish, or delete this clause]`.

**The Golden Council is a benefits tier — it does not control protocol parameters, fees, or treasury.** Council membership confers no decision-making authority over MineSwap fee allocation ratios, cashback rebate percentages, burn scheduling, treasury disbursements, partnerships, or any other aspect of protocol operation, and confers no ownership, equity, or profit-sharing interest in the protocol. Protocol parameters are administered by the BaseGold team within the constraints of the deployed smart contracts described in Section 9. `[CONFIRM-WITH-JUSTIN: confirm this description of parameter administration with the attorney before publish.]`

The Community Treasury, funded by the 8% token allocation, provides resources for ecosystem initiatives including seasonal airdrops to active participants, ecosystem grants, and strategic partnerships. `[CONFIRM-WITH-JUSTIN: in v2.0 these treasury uses were described as "approved through governance votes." Confirm with the attorney how treasury disbursement decisions should now be described — they must not be presented as Council-directed.]`

---

## 9. Technical Infrastructure

### 9.1 Base Network

BaseGold is deployed on Base, a secure and low-cost Layer 2 Ethereum rollup developed by Coinbase. Base inherits the full security guarantees of Ethereum mainnet through optimistic rollup architecture while providing transaction costs under $0.01 and confirmation times measured in seconds. The network's integration with Coinbase's infrastructure provides a seamless fiat on-ramp for millions of existing users.

### 9.2 Smart Contract Security and Audit Standards

All BaseGold smart contracts are built on OpenZeppelin's audited standard library implementations, the most widely adopted and battle-tested contract framework in the Ethereum ecosystem. Every deployed contract is verified and published on BaseScan, enabling full public inspection of all bytecode and source code. The MineSwap contract suite has undergone professional security review through Blockaid, with ongoing real-time monitoring for anomalous transaction patterns and potential exploit vectors.

The protocol adheres to current industry security standards across its entire contract architecture. All token transfers, fee distributions, rebate claims, NFT minting operations, and burn executions are processed through trustless smart contract logic with no administrative override capability on user funds. This means that once a transaction is initiated, it completes according to the contract's deterministic rules—no team member, operator, or third party can intercept, redirect, or modify the outcome.

The combination of audited contract code, trustless execution, and hardware-secured administration provides defense in depth across every layer of the protocol.

### 9.3 Application Stack

The BaseGold web application is built with Next.js and integrates with the blockchain through the wagmi and viem libraries for wallet connectivity and contract interaction. Game state for The Mine is managed through Redis for low-latency performance, with the full application deployed on Vercel's edge network for global availability and minimal response times.

---

## 10. Development Roadmap

| Phase | Milestones |
|---|---|
| **Phase 1** | Contract deployment on Base Network • Liquidity established across 7 DEXs • Whitepaper and documentation published • DexScreener Enhanced listing • CoinMarketCap listing |
| **Phase 2** | MineSwap DEX deployment with buyback-and-burn engine • Trader cashback rebate system launch • The Mine application with NFT mine plot minting • OpenSea marketplace integration for mine plot trading • Buyback-and-burn shop implementation • The Mine Season 2 tournament • Golden Council holder benefits tier rollout • CoinGecko listing • Centralized exchange listing |
| **Phase 3** | Aave lending integration • Airdrop distribution system tied to mine plot metadata • Staking platform with tiered reward periods • Cross-chain expansion evaluation |
| **Phase 4** | Tokenized RWA liquidity pairs (gold, silver, equities, commodities) • Merchant payment integrations • NFT collection for holders • Advanced DeFi protocol partnerships • Tier 1 exchange listings (Coinbase, Binance) • Mobile application and wallet deployment |

*Table 3. BaseGold protocol development phases.*

---

## 11. Conclusion

BaseGold presents a comprehensive approach to digital asset design that addresses the limitations of both inflationary token models and scarcity-only projects. By combining extreme supply constraints with utility-generating infrastructure—a gamified exchange with autonomous buyback-and-burn mechanics, a cashback system that rewards active participation, an interactive mining application with tradeable NFT mine plots, and a multi-tier referral protocol—the protocol creates self-reinforcing demand while continuously contracting supply.

The MineSwap architecture transforms every trade into a deflationary event. The Mine transforms every gameplay action into permanent, ownable value recorded on-chain—while its buyback-and-burn shop ensures that in-game spending simultaneously enriches the player's NFT and reduces the circulating token supply. Liquidity provisioned against the strongest store-of-value assets—from ETH and BTC to upcoming tokenized gold, silver, and equities—anchors BaseGold within the most trusted asset classes across both digital and traditional markets. The Golden Council recognizes and rewards the protocol's most committed holders, with member benefits informed by demonstrated participation. And the fixed supply of 10,000 tokens, subject only to further reduction through burns, establishes a scarcity floor that no competing asset can replicate.

BaseGold is not merely a store of value—it is an economic system designed so that every form of participation—trading, playing, referring, holding—increases the value of participation itself.

---

*Disclaimer: This document is for informational purposes only and does not constitute financial, legal, or investment advice. Digital asset investments carry significant risk, including the potential loss of all invested capital. The forward-looking statements contained herein reflect current intentions and are subject to change. Prospective participants should conduct independent research and consult qualified financial advisors before making investment decisions.*

*© 2026 BaseGold Foundation. All rights reserved. This whitepaper and its contents are the exclusive intellectual property of BaseGold (basegold.io). No part of this document may be reproduced, distributed, transmitted, or otherwise used in any form or by any means without the prior written permission of the BaseGold Foundation. The concepts, mechanisms, branding, and proprietary systems described herein—including MineSwap, The Mine, Gold Vein, and the Golden Council—pertain strictly to BaseGold.io and may not be copied, adapted, or repurposed by any third party. Unauthorized use of this material may result in legal action.*

Contract: `0x36b712A629095234F2196BbB000D1b96C12Ce78e`
Base Network (Layer 2 Ethereum)  •  basegold.io
