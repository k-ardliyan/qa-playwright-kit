import prompts, { PromptObject } from 'prompts';
import { spawn } from 'child_process';
import { loadEnvironment } from '../../utils/env-loader';

async function main() {
  console.log('\x1b[36m%s\x1b[0m', '\n==================================================');
  console.log('\x1b[36m%s\x1b[0m', '🎭 QA Playwright Kit — Interactive Test Runner 🎭');
  console.log('\x1b[36m%s\x1b[0m', '==================================================\n');

  const questions: PromptObject[] = [
    {
      type: 'select',
      name: 'env',
      message: 'Pilih Environment target pengujian:',
      choices: [
        {
          title: 'Local Development (local)',
          value: 'local',
          description: 'Gunakan local.env',
        },
        {
          title: 'Development Server (dev)',
          value: 'dev',
          description: 'Gunakan dev.env',
        },
        {
          title: 'Staging Environment (staging)',
          value: 'staging',
          description: 'Gunakan staging.env',
        },
        {
          title: 'Production Environment (production)',
          value: 'production',
          description: '⚠️ Gunakan production.env',
        },
      ],
      initial: 0,
    },
    {
      type: 'select',
      name: 'browser',
      message: 'Pilih Browser / Proyek:',
      choices: [
        { title: 'Chromium (Default Desktop Chrome)', value: 'chromium' },
        { title: 'Semua Proyek (Multi-browser)', value: 'all' },
      ],
      initial: 0,
    },
    {
      type: 'select',
      name: 'tag',
      message: 'Pilih Grup Pengujian (Tags):',
      choices: [
        { title: 'Semua Tes (All)', value: 'all' },
        { title: 'Smoke Tests (@smoke)', value: '@smoke' },
        { title: 'Authentication (@auth)', value: '@auth' },
        { title: 'Customers (@customers)', value: '@customers' },
        { title: 'Custom (Tulis Grep Sendiri)', value: 'custom' },
      ],
      initial: 0,
    },
    {
      type: (prev: string) => (prev === 'custom' ? 'text' : null),
      name: 'customTag',
      message: 'Masukkan pola teks/tag pengujian (misal: @smoke):',
    },
    {
      type: 'select',
      name: 'mode',
      message: 'Pilih Mode Eksekusi:',
      choices: [
        { title: 'Headless (Latar Belakang - Cocok untuk CI)', value: 'headless' },
        { title: 'Headed (Tampilkan UI Browser)', value: 'headed' },
        { title: 'UI Mode (Playwright Interactive UI)', value: 'ui' },
        { title: 'Debug Mode (Playwright Debugger)', value: 'debug' },
      ],
      initial: 0,
    },
  ];

  const answers = await prompts(questions);

  // Jika dibatalkan oleh pengguna (Ctrl+C)
  if (!answers.env || !answers.browser || !answers.tag || !answers.mode) {
    console.log('\n\x1b[31m%s\x1b[0m', '❌ Eksekusi dibatalkan oleh pengguna.\n');
    process.exit(0);
  }

  // Tentukan tag yang digunakan
  let grepPattern = '';
  if (answers.tag === 'custom') {
    grepPattern = answers.customTag || '';
  } else if (answers.tag !== 'all') {
    grepPattern = answers.tag;
  }

  // Siapkan argumen Playwright
  const args = ['playwright', 'test'];

  if (answers.browser !== 'all') {
    args.push(`--project=${answers.browser}`);
  }

  if (grepPattern) {
    args.push('--grep', grepPattern);
  }

  switch (answers.mode) {
    case 'headed':
      args.push('--headed');
      break;
    case 'ui':
      args.push('--ui');
      break;
    case 'debug':
      args.push('--debug');
      break;
  }

  // Muat environment yang sesuai via env-loader
  process.env.APP_ENV = answers.env;
  loadEnvironment();

  const finalBaseUrl = process.env.BASE_URL || 'http://localhost:3000';

  console.log('\n\x1b[35m%s\x1b[0m', '--------------------------------------------------');
  console.log(`🌍 Target Env : ${answers.env.toUpperCase()}`);
  console.log(`🔗 BASE_URL   : ${finalBaseUrl}`);
  console.log(`🤖 Command    : npx ${args.join(' ')}`);
  console.log('\x1b[35m%s\x1b[0m', '--------------------------------------------------\n');
  console.log('Menjalankan pengujian...\n');

  // Eksekusi npx playwright test menggunakan spawn
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'npx.cmd' : 'npx';

  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
    },
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log(
        '\n\x1b[32m%s\x1b[0m',
        '✨ Seluruh pengujian berhasil diselesaikan dengan sukses! (Exit Code: 0)',
      );
    } else {
      console.log(
        '\n\x1b[31m%s\x1b[0m',
        `❌ Pengujian selesai dengan kegagalan atau terhenti. (Exit Code: ${code})`,
      );
    }
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error('Error running CLI interactive script:', err);
  process.exit(1);
});
