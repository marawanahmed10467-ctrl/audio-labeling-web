const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: "mysql",
  }
);

sequelize.authenticate()
  .then(() => console.log("Connected to MySQL"))
  .catch((err) => console.error("MySQL connection error:", err));

module.exports = sequelize;
