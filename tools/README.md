# Developer & Maintainer Tooling (`tools/`)

> **Boundary:** Maintainer & Tooling Layer  
> **Audience:** Framework Maintainers & Automation Engineers

Folder ini berisi tool operasional, validator arsitektur, dan MCP server:

```text
tools/
├── mcp/                  # QA Playwright Kit MCP Server (@qa-playwright-kit-mcp-server)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/              # Tool definitions & server logic
│   └── dist/             # Compiled bundle (index-mcp.js)
├── scripts/              # CLI tools & operasional (qa-run, env utilities)
│   ├── __tests__/        # Tool unit & integration tests
│   ├── qa-run.ts
│   ├── health-check-cli.ts
│   └── sync-mcp-generated.ts  # SoT → MCP copy (contracts + file-content-core)
└── validators/           # Framework validation scripts
    ├── architecture.ts   # Boundary & directory layout validator
    ├── validate-requirement.ts
    └── validate-generated-tests.ts
```

## 🛠️ Perintah Utama

- `npm run mcp:build`: Build QA Playwright Kit MCP Server.
- `npm run health:check`: Verifikasi integritas lingkungan dan tool.
- `npm run validate:architecture`: Validasi kepatuhan batas arsitektur hybrid.
