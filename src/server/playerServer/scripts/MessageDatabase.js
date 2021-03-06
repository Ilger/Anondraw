var MESSAGES_PER_REQUEST = 20;

function MessageDatabase (database) {
	this.database = database;
}

/* callback(err, messageId) */
MessageDatabase.prototype.addMessage = function addMessage (userId, to, message, callback) {
	this.database.query("INSERT INTO messages (fromId, toId, message, send, isRead) VALUES (?, ?, ?, ?, 0)", [userId, to, message, new Date()], function (err, results, fields) {
		callback(err, results && results.insertId);
	});
};

MessageDatabase.prototype.getMessageList = function getMessageList (userId, callback) {
	this.database.query("SELECT partner, last_username, CAST(MIN(isRead) AS INT) as isRead FROM ((SELECT toId as partner, 1 as isRead FROM messages WHERE fromId = ? ORDER BY send DESC) UNION ALL (SELECT fromId as partner, isRead FROM messages WHERE toId = ? ORDER BY send DESC)) as partners JOIN users ON partners.partner = users.id GROUP BY partner", [userId, userId], function (err, rows, fields) {
		callback(err, rows);
	});
};

MessageDatabase.prototype.getMessages = function getMessages (userId, partnerId, beforeId, callback) {
	var whereClause = "((toId = ? AND fromId = ?) OR (toId = ? AND fromId = ?))" + (beforeId ? " AND send < (SELECT send FROM messages WHERE id = ?)": "");
	var query = "(SELECT * FROM messages WHERE " + whereClause + " ORDER BY send DESC LIMIT " + MESSAGES_PER_REQUEST + ") ORDER BY send ASC";
	var arguments = [userId, partnerId, partnerId, userId, beforeId];
	
	this.database.query(query, arguments, function (err, results, fields) {
		callback(err, results);
	});
	
	arguments.push(userId);
	this.database.query("UPDATE messages SET isRead = 1 WHERE toId = ? AND fromId = ?", [userId, partnerId]);
};

module.exports = MessageDatabase;