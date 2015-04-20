# mail/core

This `core` plugin provides basic address parsing and validation for the `MAIL` command. It also supports the `SIZE` extension
and rejects the `MAIL` command if the size exceeds the limit provided in the server configuration in `limits.messageSize`.

If the from address and the size are okay, it adds the parsed address as `req.from` to the request object, so following
`MAIL` handlers can use it.
