import { createLogger, format, transports } from "winston";

const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
});

export const logger = createLogger({
    level: "info",
    format: combine(
        colorize(),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        logFormat
    ),
    transports: [
        new transports.Console(),
        new transports.File({ filename: "logs/app.log", level: "info" }),
        new transports.File({ filename: "logs/error.log", level: "error" }),
    ],
});

(logger as any).stream = {
    write: (message: string) => {
        logger.info(message.trim());
    },
};

export default logger;
