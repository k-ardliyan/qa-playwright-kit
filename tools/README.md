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
├── scripts/              # CLI tools & operasional (qa-run, setup-wizard, env utilities)
│   ├── __tests__/        # Tool unit & integration tests
│   ├── qa-run.ts
│   ├── setup-wizard.ts
│   └── health-check-cli.ts
└── validators/           # Framework validation scripts
    ├── architecture.ts   # Boundary & directory layout validator
    ├── validate-requirement.ts
    ├── validate-generated-tests.ts
    └── setup-check.ts
```

## 🛠️ Perintah Utama

- `npm run mcp:build`: Build QA Playwright Kit MCP Server.
- `npm run health:check`: Verifikasi integritas lingkungan dan tool.
- `npm run validate:architecture`: Validasi kepatuhan batas arsitektur hybrid.
