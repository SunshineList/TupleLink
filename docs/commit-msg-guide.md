# NaiLink Commit Message Guide

This project follows [Conventional Commits](https://www.conventionalcommits.org/) specification.

---

## 🎯 Why Conventional Commits?

- 📝 **Clear change descriptions**
- 🔍 **Easy navigation** through git history
- 🤖 **Commit checks** through commitlint; releases use the OpenWrt workflow described in [CONTRIBUTING.md](../CONTRIBUTING.md#构建与发布)
- 📊 **Better project understanding** for contributors

---

## 📐 Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

> **Note:** `<scope>` is optional

---

## 💡 Example

```
feat: add hat wobble
^--^  ^------------^
|     |
|     └──> Summary in present tense
|
└────────> Type: feat, fix, docs, style, refactor, test, chore, perf, ci
```

---

## 🏷️ Commit Types

| Type       | Description                                                      |
| ---------- | ---------------------------------------------------------------- |
| `feat`     | New feature for the user                                         |
| `fix`      | Bug fix for the user                                             |
| `docs`     | Documentation changes                                            |
| `style`    | Formatting, missing semicolons (no code logic change)            |
| `refactor` | Code refactoring (no feature or bug fix)                         |
| `test`     | Adding or refactoring tests (no production code change)          |
| `chore`    | Build process, dependencies, configs (no production code change) |
| `perf`     | Performance improvements                                         |
| `ci`       | CI/CD configuration changes                                      |

---

## 📦 Scope Examples

The scope provides additional context about what part of the codebase is affected:

- `config` — Configuration related changes
- `proxy` — Proxy functionality
- `routing` — Routing logic
- `ui` — User interface components
- `api` — API endpoints
- `deps` — Dependencies

> **Tip:** Scope can be omitted for global changes or when difficult to assign to a single component.

---

## ✍️ Writing Guidelines

### Subject Line

- Keep it under **72 characters**
- Use **lowercase** for type and scope
- Use **imperative mood**: "add" not "added" or "adds"
- **No period** at the end

### Body (Optional)

- Explain **what** and **why**, not how
- Use imperative, present tense
- Wrap at **72 characters**

### Footer (Optional)

**Closing issues:**

```
Closes #234
```

**Multiple issues:**

```
Closes #123, #245, #992
```

**Breaking changes:**

```
BREAKING CHANGE: description of what broke and migration path
```

---

## 📚 References

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Angular Commit Guidelines](https://github.com/angular/angular/blob/main/CONTRIBUTING.md#commit)
- [Semantic Commit Messages](https://seesparkbox.com/foundry/semantic_commit_messages)
