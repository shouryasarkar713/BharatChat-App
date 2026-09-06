const { execSync } = require('child_process');
try {
  console.log("Running prisma db push...");
  const out1 = execSync('npx prisma db push', { stdio: 'pipe' });
  console.log("Output:\n", out1.toString());

  console.log("Running prisma generate...");
  const out2 = execSync('npx prisma generate', { stdio: 'pipe' });
  console.log("Output:\n", out2.toString());
} catch (e) {
  console.error("Error executing command:", e.message);
  if (e.stdout) console.log("stdout:", e.stdout.toString());
  if (e.stderr) console.error("stderr:", e.stderr.toString());
}
