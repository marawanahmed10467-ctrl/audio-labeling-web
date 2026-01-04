const express = require('express');
const router = express.Router();
const { docClient } = require('../utils/dynamodb');
const { ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.LABELS_TABLE;

// avoid negative remaining if label_count > target_labels
const calcRemaining = (targetLabels, labelCount) => Math.max(0, Number(targetLabels) - Number(labelCount));


router.post("/label-count/increment", async (req, res) => {
  try {
    const mode = req.body?.mode; // "type" | "severity" | "age" | "gender" | "whole_label"
    const setTo = Number(req.body?.setTo);

    const allowedModes = new Set(["type", "severity", "age", "gender", "whole_label"]);
    if (!allowedModes.has(mode)) {
      return res.status(400).json({ error: "mode must be one of: type, severity, age, gender, whole_label" });
    }
    if (!Number.isFinite(setTo) || setTo < 0) {
      return res.status(400).json({ error: "setTo must be a number >= 0" });
    }

    const scanParams = {
      TableName: TABLE_NAME,
      ProjectionExpression: "id, label_map, label_confidence, label_count, target_labels",
      FilterExpression: "label_confidence < :one",
      ExpressionAttributeValues: { ":one": 1 }
    };

    let lastEvaluatedKey;
    let scannedItems = 0;
    let matchedRows = 0;
    let updatedRows = 0;

    do {
      const page = await docClient.send(new ScanCommand({
        ...scanParams,
        ExclusiveStartKey: lastEvaluatedKey
      }));

      const items = page.Items ?? [];
      scannedItems += items.length;

      const batchSize = 10;
      for (let i = 0; i < items.length; i += batchSize) {
        await Promise.all(items.slice(i, i + batchSize).map(async (item) => {
          if (!item?.id) return;
          if (!Array.isArray(item.label_map) || item.label_map.length === 0) return;

          const distinct = new Set();

          for (const label of item.label_map) {
            const s = typeof label === "string" ? label : label?.S;
            if (!s) continue;

            if (mode === "whole_label") {
              distinct.add(s);
            } else {
              const [type, severity, age, gender] = s.split("_");
              const chosen =
                mode === "type" ? type :
                mode === "severity" ? severity :
                mode === "age" ? age :
                gender;
              if (chosen) distinct.add(chosen);
            }
          }

          // Only set if this ROW has >1 distinct values for that mode
          if (distinct.size <= 1) return;

          matchedRows += 1;

          const labelCount = Number(item.label_count ?? 0);
          const remaining = calcRemaining(setTo, labelCount);

          await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: item.id },
            UpdateExpression: "SET target_labels = :setTo, remaining_labels = :remaining",
            ExpressionAttributeValues: {
              ":setTo": setTo,
              ":remaining": remaining
            }
          }));

          updatedRows += 1;
        }));
      }

      lastEvaluatedKey = page.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    res.json({
      message: "target_labels + remaining_labels SET completed",
      mode,
      setTo,
      scannedItems,
      matchedRows,
      updatedRows
    });

  } catch (error) {
    console.error("Error setting target_labels/remaining_labels:", error);
    res.status(500).json({ error: "Failed to set target_labels/remaining_labels" });
  }
});



router.post("/blacklisted-users/increment-label-count", async (req, res) => {
  try {
    const email = (req.body?.email || "").trim();
    const setTo = Number(req.body?.setTo);

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }
    if (!Number.isFinite(setTo) || setTo < 0) {
      return res.status(400).json({ error: "setTo must be a number >= 0" });
    }

    const scanParams = {
      TableName: TABLE_NAME,
      ProjectionExpression: "id, blacklisted_users, label_count",
      FilterExpression: "contains(blacklisted_users, :email)",
      ExpressionAttributeValues: {
        ":email": email
      }
    };

    let lastEvaluatedKey;
    let scannedItems = 0;
    let matchedRows = 0;
    let updatedRows = 0;

    do {
      const page = await docClient.send(new ScanCommand({
        ...scanParams,
        ExclusiveStartKey: lastEvaluatedKey
      }));

      const items = page.Items ?? [];
      scannedItems += items.length;

      const batchSize = 10;
      for (let i = 0; i < items.length; i += batchSize) {
        await Promise.all(items.slice(i, i + batchSize).map(async (item) => {
          if (!item?.id) return;

          matchedRows += 1;

          const labelCount = Number(item.label_count ?? 0);
          const remaining = calcRemaining(setTo, labelCount);

          await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: item.id },
            UpdateExpression: "SET target_labels = :setTo, remaining_labels = :remaining",
            ExpressionAttributeValues: {
              ":setTo": setTo,
              ":remaining": remaining
            }
          }));

          updatedRows += 1;
        }));
      }

      lastEvaluatedKey = page.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return res.json({
      message: "target_labels + remaining_labels SET completed for blacklisted user filter",
      email,
      setTo,
      scannedItems,
      matchedRows,
      updatedRows
    });

  } catch (error) {
    console.error("Error setting target_labels/remaining_labels for blacklisted user:", error);
    return res.status(500).json({ error: "Set failed" });
  }
});



router.post("/priority/increment-label-count", async (req, res) => {
  try {
    const priority = req.body?.priority;
    const setTo = Number(req.body?.setTo);

    if (priority === undefined || priority === null) {
      return res.status(400).json({ error: "priority is required" });
    }
    if (!Number.isFinite(setTo) || setTo < 0) {
      return res.status(400).json({ error: "setTo must be a number >= 0" });
    }

    const scanParams = {
      TableName: TABLE_NAME,
      ProjectionExpression: "id, priority, label_count",
      FilterExpression: "#p = :priority",
      ExpressionAttributeNames: {
        "#p": "priority"
      },
      ExpressionAttributeValues: {
        ":priority": priority
      }
    };

    let lastEvaluatedKey;
    let scannedItems = 0;
    let matchedRows = 0;
    let updatedRows = 0;

    do {
      const page = await docClient.send(new ScanCommand({
        ...scanParams,
        ExclusiveStartKey: lastEvaluatedKey
      }));

      const items = page.Items ?? [];
      scannedItems += items.length;

      const batchSize = 10;
      for (let i = 0; i < items.length; i += batchSize) {
        await Promise.all(items.slice(i, i + batchSize).map(async (item) => {
          if (!item?.id) return;

          matchedRows += 1;

          const labelCount = Number(item.label_count ?? 0);
          const remaining = calcRemaining(setTo, labelCount);

          await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: item.id },
            UpdateExpression: "SET target_labels = :setTo, remaining_labels = :remaining",
            ExpressionAttributeValues: {
              ":setTo": setTo,
              ":remaining": remaining
            }
          }));

          updatedRows += 1;
        }));
      }

      lastEvaluatedKey = page.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return res.json({
      message: "target_labels + remaining_labels SET completed for priority filter",
      priority,
      setTo,
      scannedItems,
      matchedRows,
      updatedRows
    });

  } catch (error) {
    console.error("Error setting target_labels/remaining_labels by priority:", error);
    return res.status(500).json({ error: "Set failed" });
  }
});



router.post("/original-names/increment-label-count", async (req, res) => {
  try {
    const names = req.body?.names;
    const setTo = Number(req.body?.setTo);

    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: "names must be a non-empty array" });
    }
    if (!Number.isFinite(setTo) || setTo < 0) {
      return res.status(400).json({ error: "setTo must be a number >= 0" });
    }

    const filterExpressions = [];
    const ExpressionAttributeValues = {};

    names.forEach((name, i) => {
      const key = `:n${i}`;
      filterExpressions.push(`original_name = ${key}`);
      ExpressionAttributeValues[key] = name;
    });

    const scanParams = {
      TableName: TABLE_NAME,
      ProjectionExpression: "id, original_name, label_count",
      FilterExpression: filterExpressions.join(" OR "),
      ExpressionAttributeValues
    };

    let lastEvaluatedKey;
    let scannedItems = 0;
    let matchedRows = 0;
    let updatedRows = 0;

    do {
      const page = await docClient.send(new ScanCommand({
        ...scanParams,
        ExclusiveStartKey: lastEvaluatedKey
      }));

      const items = page.Items ?? [];
      scannedItems += items.length;

      const batchSize = 10;
      for (let i = 0; i < items.length; i += batchSize) {
        await Promise.all(items.slice(i, i + batchSize).map(async (item) => {
          if (!item?.id) return;

          matchedRows += 1;

          const labelCount = Number(item.label_count ?? 0);
          const remaining = calcRemaining(setTo, labelCount);

          await docClient.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { id: item.id },
            UpdateExpression: "SET target_labels = :setTo, remaining_labels = :remaining",
            ExpressionAttributeValues: {
              ":setTo": setTo,
              ":remaining": remaining
            }
          }));

          updatedRows += 1;
        }));
      }

      lastEvaluatedKey = page.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return res.json({
      message: "target_labels + remaining_labels SET completed for original_name filter",
      names,
      setTo,
      scannedItems,
      matchedRows,
      updatedRows
    });

  } catch (error) {
    console.error("Error setting target_labels/remaining_labels by original_name:", error);
    return res.status(500).json({ error: "Set failed" });
  }
});

module.exports = router;
