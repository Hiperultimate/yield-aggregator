# Yield Aggregator

> A smart yield optimization protocol on Solana that automatically rebalances funds between Jupiter Lend and Kamino Lend to maximize APY.

## Overview

The **Yield Aggregator** is a Solana-based protocol designed to optimize lending yields. It intelligently monitors and compares the Annual Percentage Yield (APY) offered by **Jupiter Lend** and **Kamino Lend**, dynamically allocating user funds to the protocol offering the superior return.

This project leverages the **Anchor Framework** for on-chain logic and utilizes **Surfpool** for robust testing against real Mainnet forks, ensuring reliable Cross-Program Invocations (CPIs).

## Key Features

-   **Automated Yield Optimization**: Continuously seeks the best lending rates.
-   **Dual-Protocol Integration**: Seamlessly interacts with both Jupiter Lend and Kamino Lend.
-   **Smart Rebalancing**: Allocates capital efficiently based on real-time performance metrics.
-   **Worker Bot Ready**: Includes a `client_utility` suite designed for off-chain worker bots to trigger rebalancing and maintenance tasks.
-   **Real-World Testing**: rigorous testing environment using **Surfpool** to simulate Mainnet conditions.

## Architecture

The project consists of three main components:

1.  **On-Chain Program** (`/programs`): The core Anchor program that holds user funds and executes deposit/withdraw logic via CPIs to lending protocols.
2.  **Client Utilities** (`/client_utility`): TypeScript modules providing essential methods for interacting with the program. These are designed to be consumed by a future **Worker Bot** for automated operations.
3.  **Integration Tests** (`/tests`): Comprehensive test suite using Surfpool to validate logic against live protocol states.

## Getting Started

### Prerequisites

Ensure you have the following installed:

-   [Node.js](https://nodejs.org/) (v18+)
-   [Rust & Cargo](https://rustup.rs/)
-   [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
-   [Anchor Framework](https://www.anchor-lang.com/)
-   [Surfpool](https://docs.surfpool.run/) (for testing)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd yield-aggregator
    ```

2.  **Install dependencies:**
    ```bash
    yarn install
    ```

3.  **Build the program:**
    ```bash
    anchor build
    ```

## Testing

We use **Surfpool** to run tests against a forked Mainnet environment, allowing us to interact with the real Jupiter and Kamino programs.

1.  **Start Surfpool:**
    ```bash
    surfpool start --watch
    ```

2.  **Run Tests:**
    In a separate terminal, run:
    ```bash
    anchor test
    ```

## Directory Structure

```
yield-aggregator/
├── programs/           # Solana smart contracts (Anchor)
├── client_utility/     # Helper scripts for client/bot interactions
├── tests/              # Integration tests
├── migrations/         # Deploy scripts
└── Anchor.toml         # Project configuration
```

## Client Utility

The `client_utility` folder contains specialized scripts for the worker bot:

-   `invokeClientWithdraw.ts`: Handles user withdrawal requests.
-   `invokeRebalance.ts`: Logic for checking APYs and rebalancing funds.
-   `helper-fns.ts`: Common utilities for transaction management.

## 📝 Todo / Future Features

- [ ] **Client Withdraw Feature**: Complete the implementation of the client-side withdrawal logic.
- [ ] **Bot Server**: Develop a dedicated server to run the automation bot for rebalancing and maintenance.
- [ ] **Liquidity Check & Trickle-In Strategy**: Implement a feature to check protocol liquidity before withdrawals. If liquidity is insufficient, the system should "trickle in" funds bit by bit to the user's vault instead of failing or blocking the withdrawal.