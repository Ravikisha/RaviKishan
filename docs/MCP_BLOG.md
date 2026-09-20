# Blog automation through MCP

The remote MCP server can create and maintain blog posts from Claude Code, Codex,
or any MCP client that supports Streamable HTTP and bearer authentication.

## Capabilities

- `create_post`: create a draft or publish immediately; accepts `title`, `body`,
  `excerpt`, `tags`, `slug`, and `cover`.
- `update_post`: update title, full Markdown body, excerpt, tags, or cover URL.
- `publish_post`: publish or unpublish an existing post.
- `upload_blog_image`: upload an image from base64 bytes to the site's media
  endpoint. It returns a permanent same-domain `url` and ready-to-paste
  Markdown. Pass `cover: true` when the image should be the post cover.
- `delete_post`: remove a post.
- `crosspost_to_devto`: publish or update a first-party post on dev.to after it
  has been edited here.

Inline images are ordinary Markdown in `body`:

```markdown
![Architecture diagram](/api/media/blog/123-diagram.png)
```

## Complete workflow

1. Call `upload_blog_image` for the cover with `cover: true`.
2. Call it again for each inline image with `cover: false`.
3. Call `create_post` with the returned cover `url` and the returned Markdown
   snippets in `body`.
4. Call `publish_post` if the post was initially created as a draft.
5. Call `update_post` later with the same slug to edit the article or cover.
6. Call `crosspost_to_devto` when the article should also be published on dev.to.

The MCP token needs both `read` and `write` scopes. Storage must be configured
with the `B2_*` environment variables because image bytes are uploaded through
the site's media bucket. Firestore rules and the MCP token still enforce the
admin account; the AI client does not bypass them.

## Client examples

Claude Code can be configured with the MCP endpoint shown in the admin MCP
panel. Codex and other clients use the same endpoint and bearer header. The
client must support tool calls with JSON arguments and must be allowed to send
base64 image data for image uploads.

## Verification

Run the protocol and tool-surface checks with:

```powershell
npm run mcp:check
```

For a live authenticated read/write check, set `MCP_TOKEN` in the environment
and run the same command. Never commit the token or place it in a repository
file.
