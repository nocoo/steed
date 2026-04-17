import { Command } from "commander";
import { createInitCommand } from "./commands/init.js";
import { createLoginCommand } from "./commands/login.js";
import { createScanCommand } from "./commands/scan.js";
import { createReportCommand } from "./commands/report.js";
import { createRegisterCommand } from "./commands/register.js";
import { createStatusCommand } from "./commands/status.js";
import { createConfigCommand } from "./commands/config.js";
import { createServiceCommand } from "./commands/service.js";

const VERSION = "0.1.0";

function createProgram(): Command {
  const program = new Command();

  program
    .name("steed")
    .description("Steed CLI — Agent asset visibility")
    .version(VERSION);

  // Add commands
  program.addCommand(createInitCommand());
  program.addCommand(createLoginCommand());
  createScanCommand(program);
  createReportCommand(program);
  createRegisterCommand(program);
  createStatusCommand(program);
  createConfigCommand(program);
  createServiceCommand(program);

  return program;
}

export function main(): void {
  const program = createProgram();
  program.parse();
}

export { createProgram };
