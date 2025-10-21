exports.authenticateAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token || token !== "admin") return res.status(401).json({ message: "Unauthorized" });
  next();
};
