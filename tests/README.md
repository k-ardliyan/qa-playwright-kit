# Playwright Test Workspace (`tests/`)

> **Boundary:** Playwright Automation Source (Committed Source Code)  
> **Audience:** QA Engineers & Automation Engineers

Folder ini adalah **test workspace resmi Playwright** tempat seluruh skenario pengujian disimpan:

```text
tests/
├── seed.spec.ts          # Minimal seed test untuk inisialisasi Planner
├── auth.setup.ts         # Playwright setup project entrypoint untuk otentikasi
├── fixtures.ts           # Stable test adapter (test, expect, authStatePath, setTestMetadata)
├── pages/                # Page Object Models aplikasi
├── data/                 # Sample file upload/download, pdf, xlsx, network contracts
├── demo/                 # Demo test project
└── <feature>.spec.ts     # Skenario pengujian (role-aware atau general)
```

## 🚀 Konvensi Penulisan Tes

1. **Import via Adapter**:

   ```ts
   import { test, expect } from './fixtures';
   import { LoginPage } from './pages/auth/login.page';
   ```

2. **Traceability Header**:

   ```ts
   // req: requirements/<feature>.md
   // spec: specs/<feature>-plan.md
   // seed: tests/seed.spec.ts
   ```

3. **Committed Source**: Seluruh file tes di dalam `tests/` adalah committed source code, bukan artefak sementara.
