# data/core

This `core` plugin add support for the `DATA` command.
It makes sure that all preconditions are satisfied (`EHLO`/`HELO`, `MAIL`, `RCPT`) and then streams the data to a temporary file.
It also adds a `Received` header to the mail content.
Once the client has finished sending the message, it will emit the `queue` event, that can be used to send the final response code
back to the client.

> Note: if you want to process any data coming from the client, it is best to listen for the `queue` event. You should rarely every
> have to listen for the `data` event as this handler is implementing the low level protocol specifics for receiving the data.