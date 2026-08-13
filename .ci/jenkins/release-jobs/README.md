# Two-Phase Apache Release Process

Apache releases require community voting on Release Candidates before final publication. This follows Apache Software Foundation release guidelines.

## Overview

1. **Phase 1 — Create Release Candidate**: Build all artifacts, sign with GPG, publish to Apache SVN `dev/` for community voting
2. **Phase 2 — Publish Release**: After the vote passes, publish to public registries (npm, VSCode Marketplace, Chrome Web Store, Docker Hub, GitHub Releases, GitHub Pages)

## Phase 1: Create Release Candidate

**Jenkinsfile**: `Jenkinsfile.release-candidate`

### Parameters

| Parameter                   | Description          | Example                          |
| --------------------------- | -------------------- | -------------------------------- |
| `RELEASE_VERSION`           | Version to release   | `10.2.0`                         |
| `RELEASE_CANDIDATE_VERSION` | RC suffix            | `rc1`                            |
| `BASE_REF`                  | Branch to build from | `10.2.x`                         |
| `COMPONENT`                 | What to build        | `all`, `npm`, `chrome`, `vscode` |

### What it does

1. Checks out `BASE_REF`
2. Updates versions (`pnpm update-version-to`, `update-kogito-version-to`, `update-stream-name-to`)
3. Runs `scripts/release/release-all.sh <version> --rc` (or the component-specific script)
4. Signs all artifacts with GPG
5. Publishes signed artifacts to Apache SVN `dev/incubator/kie/<RC>/`

Does **not** publish to npm, VSCode Marketplace, Chrome Web Store, or Docker Hub.

## Phase 2: Publish Release

**Jenkinsfile**: `Jenkinsfile.release-publish`

### Parameters

| Parameter            | Description                              | Example                          |
| -------------------- | ---------------------------------------- | -------------------------------- |
| `RELEASE_VERSION`    | Version to publish (must match voted RC) | `10.2.0`                         |
| `BASE_REF`           | Approved RC tag                          | `10.2.0-rc1`                     |
| `COMPONENT`          | What to publish                          | `all`, `npm`, `chrome`, `vscode` |
| `GITHUB_RELEASE_TAG` | GitHub release tag for asset upload      | `10.2.0`                         |

### What it does

1. Checks out the approved RC tag
2. Verifies `package.json` version matches `RELEASE_VERSION`
3. Runs `scripts/release/release-all.sh <version> --publish` (or component-specific script)
4. Uploads `.vsix`, binary zips and tarballs to the GitHub Release

## Complete Release Workflow

### Step 1: Create Release Candidate

Run `Jenkinsfile.release-candidate` with:

```
RELEASE_VERSION = "10.2.0"
RELEASE_CANDIDATE_VERSION = "rc1"
BASE_REF = "10.2.x"
COMPONENT = "all"
```

### Step 2: Community Vote

Send a `[VOTE]` email to `dev@kie.apache.org` including:

- Link to SVN dev artifacts
- Link to the RC Git tag
- Link to the KEYS file

Wait 72 hours minimum. Three `+1` votes from PMC members are required.

### Step 3: Publish Release (after vote passes)

Run `Jenkinsfile.release-publish` with:

```
RELEASE_VERSION = "10.2.0"
BASE_REF = "10.2.0-rc1"
COMPONENT = "all"
GITHUB_RELEASE_TAG = "10.2.0"
```

### Step 4: Finalize

```bash
# Move artifacts from SVN dev/ to release/
svn mv https://dist.apache.org/repos/dist/dev/incubator/kie/10.2.0-rc1 \
       https://dist.apache.org/repos/dist/release/incubator/kie/10.2.0

# Create final Git tag pointing to the RC commit
git tag -a 10.2.0 10.2.0-rc1
git push origin 10.2.0

# Send [ANNOUNCE] email
```

## Local Scripts

Both Jenkinsfiles delegate to scripts in `scripts/release/`. The full list:

| Script                                     | RC artifact(s) produced (`apache-kie-<version>-incubating-*`)                                                                                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-npm-packages.sh`                  | `tools-npm-packages.zip`                                                                                                                                                                                                                                   |
| `release-chrome-extensions.sh`             | `business-automation-chrome-extension.zip`, `business-automation-chrome-extension-editors.zip`                                                                                                                                                             |
| `release-vscode.sh`                        | `bpmn-vscode-extension.vsix`, `dmn-vscode-extension.vsix`, `drl-vscode-extension.vsix`, `pmml-vscode-extension.vsix`, `kogito-bundle-vscode-extension.vsix`, `business-automation-bundle-vscode-extension.vsix`, `extended-services-vscode-extension.vsix` |
| `release-container-images.sh`              | `<image-name>-image.tar.gz` per image (15 images)                                                                                                                                                                                                          |
| `release-helm-charts.sh`                   | `sandbox-helm-chart.tar.gz`, `runtime-tools-console-helm-chart.tar.gz`                                                                                                                                                                                     |
| `release-github-pages.sh`                  | `sandbox-webapp.zip`, `business-automation-standalone-editors.zip`, `sandbox-accelerator-quarkus.zip`; also pushes to GitHub Pages and accelerator repo                                                                                                    |
| `release-kn-plugin-workflow.sh`            | `sonataflow-knative-plugin-{linux-x86,macOS-arm64,macOS-x86,windows-x86}.zip`                                                                                                                                                                              |
| `release-dev-deployment-upload-service.sh` | `sandbox-dev-deployment-upload-service-{macOS-arm64,macOS-x86,linux-x86,windows-x86}.tar.gz`                                                                                                                                                               |
| `create-source-tarball.sh`                 | `incubator-kie-<version>-sources.tar.gz` (always created; does not accept `--rc`/`--publish`)                                                                                                                                                              |
| `release-all.sh`                           | Runs all of the above                                                                                                                                                                                                                                      |

See [`../../scripts/release/README.md`](../../scripts/release/README.md) for usage details.

## Credentials Required

### Phase 1

- GPG signing key (`asfReleaseGPGKeyCredentialsId`)
- Apache SVN credentials (`asfReleaseSVNStagingCredentialsId`)
- GitHub credentials (for checkout)

### Phase 2

| Credential                                                                                               | Used for                                               |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `NPM_TOKEN`                                                                                              | npm publish                                            |
| `VSCE_PAT`                                                                                               | VSCode Marketplace                                     |
| `CHROME_CLIENT_ID` / `CHROME_CLIENT_SECRET` / `CHROME_REFRESH_TOKEN` / `CHROME_KIE_EDITORS_EXTENSION_ID` | Chrome Web Store                                       |
| `DOCKER_USERNAME` / `DOCKER_PASSWORD`                                                                    | Container registry push                                |
| `HELM_REGISTRY`                                                                                          | Helm OCI push                                          |
| `GITHUB_TOKEN`                                                                                           | GitHub Pages, accelerator repo, GitHub Release uploads |

## See Also

- [Apache Release Policy](https://www.apache.org/legal/release-policy.html)
- [Apache Voting Process](https://www.apache.org/foundation/voting.html)
- [Release Scripts](../../scripts/release/README.md)
