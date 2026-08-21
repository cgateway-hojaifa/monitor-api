const fs = require("fs");
const path = require("path");

// Read .env file
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
  console.log("Loaded .env");
} else {
  console.warn("Warning: .env not found, using existing environment variables.");
}

const { Sequelize, DataTypes } = require("sequelize");

const sequelize = new Sequelize(
  process.env.MYSQL_DATABASE,
  process.env.MYSQL_USERNAME,
  process.env.MYSQL_PASSWORD,
  {
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT) || 3306,
    dialect: "mysql",
    logging: console.log,
  }
);

const User = sequelize.define("User", {
  id:       { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  email:    { type: DataTypes.STRING(255), allowNull: false, unique: true },
  password: { type: DataTypes.STRING(255), allowNull: false },
  name:     { type: DataTypes.STRING(100), allowNull: false, defaultValue: "" },
}, { tableName: "users", timestamps: true, createdAt: "created_at", updatedAt: "updated_at" });

const Project = sequelize.define("Project", {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  name:        { type: DataTypes.STRING(150), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: "projects", timestamps: true, createdAt: "created_at", updatedAt: "updated_at" });

const FileRecord = sequelize.define("FileRecord", {
  id:             { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  project_id:     { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  file_name:      { type: DataTypes.STRING(255), allowNull: false },
  file_content:   { type: DataTypes.TEXT("long"), allowNull: false },
  file_url:       { type: DataTypes.STRING(2048), allowNull: false },
  last_check:     { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  current_status: { type: DataTypes.ENUM("valid", "invalid", "unchecked"), allowNull: false, defaultValue: "unchecked" },
}, { tableName: "files", timestamps: true, createdAt: "created_at", updatedAt: "updated_at" });

const CheckHistory = sequelize.define("CheckHistory", {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  file_id:     { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  check_time:  { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  file_status: { type: DataTypes.ENUM("valid", "invalid", "error"), allowNull: false },
  // summary: { type: DataTypes.TEXT("long"), allowNull: true },
}, { tableName: "check_history", timestamps: true, createdAt: "created_at", updatedAt: false });

const Notification = sequelize.define("Notification", {
  id:     { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  type:   { type: DataTypes.ENUM("email", "slack"), allowNull: false },
  name:   { type: DataTypes.STRING(150), allowNull: false },
  target: { type: DataTypes.STRING(500), allowNull: false },
  status: { type: DataTypes.ENUM("active", "inactive"), allowNull: false, defaultValue: "active" },
}, { tableName: "notifications", timestamps: true, createdAt: "created_at", updatedAt: "updated_at" });

(async () => {
  try {
    await sequelize.authenticate();
    console.log("Database connected.");

    await User.sync({ alter: true });
    console.log("Table 'users' synced.");

    await Project.sync({ alter: true });
    console.log("Table 'projects' synced.");

    await FileRecord.sync({ alter: true });
    console.log("Table 'files' synced.");

    await CheckHistory.sync({ alter: true });
    console.log("Table 'check_history' synced.");

    await Notification.sync({ alter: true });
    console.log("Table 'notifications' synced.");

    console.log("\nAll tables synced successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Sync failed:", err.message);
    process.exit(1);
  }
})();