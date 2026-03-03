# DarkNet Strategy Guide: BitNode 15

This document serves as the definitive reference for navigating and conquering the DarkNet in BitNode 15. It maps game mechanics to formal Computer Science problems and provides a systematic strategy for deep penetration. The DarkNet is a complex, dynamic environment that requires a blend of algorithmic precision, tactical patience, and architectural foresight.

## Part 1: Computer Science Problems

The DarkNet is composed of 24 distinct authentication models, each representing a specific class of computational challenge. Understanding these models at a fundamental level is the key to automating the penetration process.

### 1. ZeroLogon (Tier 0)

ZeroLogon represents the most basic form of authentication failure: the null or empty credential. In real-world systems, this often occurs due to misconfigured services, default "no-password" states, or bypasses in the authentication logic where an empty input is treated as a valid token. This model serves as the foundational entry point into the DarkNet, illustrating that even the most complex networks can have trivial vulnerabilities at their perimeter. It highlights the importance of basic security hygiene and the risks associated with uninitialized or default configurations. The name itself is a play on the infamous CVE-2020-1472 vulnerability, though in this context, it refers to a much simpler logic flaw. It is the "Hello World" of DarkNet exploitation, requiring zero information and zero effort to bypass. This model is a reminder that the strongest encryption is useless if the front door is left unlocked. In the DarkNet, it is the only model that does not require a hint or a search space, as the solution is a universal constant. It is the first step in every penetration run, providing the initial foothold from which all further attacks are launched. Understanding ZeroLogon is about understanding the baseline of the network's security posture. If a system fails this test, it is likely that other, more complex vulnerabilities exist deeper within its architecture. It is the ultimate "low-hanging fruit" in the hacker's arsenal.

#### Formal CS Problem Statement

Let $A$ be an authentication function such that $A(P) \in \{True, False\}$, where $P$ is a candidate password string. The ZeroLogon model is defined by the property:
$$A(\epsilon) = True$$
where $\epsilon$ denotes the empty string (a string of length zero). The goal is to find any $P$ such that $A(P) = True$. In a more formal sense, we are looking for an element in the kernel of the authentication mapping that corresponds to the identity element of the string monoid. This vulnerability is often the result of a logic error where the system checks for the presence of a password but fails to validate its content, effectively treating a null input as a successful match. It can also be viewed as a failure of the "fail-secure" principle, where the default state of the system is open rather than closed. Mathematically, the search space is reduced to a single point, making the probability of success $P(success) = 1$ for the first attempt. This is the only model in the DarkNet where the entropy of the password is zero. The function $A$ effectively ignores its input $P$ when $P = \epsilon$, bypassing all internal validation routines. This can be modeled as a short-circuit in the boolean logic of the authentication service. In a state machine representation, the "Unauthenticated" state transitions directly to the "Authenticated" state upon receiving an empty input, without passing through any intermediate verification states. This lack of state transition complexity is what makes ZeroLogon so powerful and so dangerous. It is the simplest possible case of an authentication bypass.
$$A(\epsilon) = True$$
where $\epsilon$ denotes the empty string (a string of length zero). The goal is to find any $P$ such that $A(P) = True$.

#### Optimal Algorithm

The algorithm is trivial: provide the empty string as the password. This is the simplest possible solver in the DarkNet toolkit. It requires no external data, no complex logic, and no iterative processes. The implementation simply calls the authentication function with a literal empty string. This approach is effective because it targets a specific, well-defined weakness in the target's authentication logic. In a production environment, this solver is usually the first one tried by any automated penetration script. It acts as a "sanity check" for the target's security configuration. The solver does not need to handle any hints or metadata, as the solution is independent of the server's state. It is a pure function that always returns the same result.

```pseudocode
function solveZeroLogon():
    // The ZeroLogon model accepts an empty string as a valid credential.
    // This is the simplest possible solver in the DarkNet toolkit.
    // It requires no external data, no complex logic, and no iterative processes.
    // The implementation simply calls the authentication function with a literal empty string.
    return ""
```

```pseudocode
function solveZeroLogon():
    // The ZeroLogon model accepts an empty string as a valid credential.
    // This is the simplest possible solver.
    return ""
```

#### Complexity Analysis

- **Time Complexity:** $O(1)$. The operation takes a constant amount of time regardless of any external factors. The time taken is independent of the network size, the server's depth, or any other variable. It is the theoretical lower bound for any authentication attempt. There are no loops, no recursions, and no complex operations involved. The execution time is limited only by the overhead of the function call itself.
- **Space Complexity:** $O(1)$. No additional memory is required to store or process the solution. The memory footprint is minimal and does not scale with any input parameters. The solver does not need to maintain any state or store any intermediate results. It is a stateless operation that is highly efficient in resource-constrained environments.
- **Network Complexity:** $O(1)$. Only a single network request is sent to the server. This minimizes the risk of detection and reduces the impact of network latency on the overall penetration time. It is the most stealthy and efficient attack possible.
- **Space Complexity:** $O(1)$. No additional memory is required to store or process the solution.

#### Worked Example: Step-by-Step Execution

1.  **Initialization:** The solver is invoked for a server identified as running the ZeroLogon model. The manager script detects that the server is at Depth 0 or has no associated hint.
2.  **Execution:** The solver function `solveZeroLogon()` is called. It prepares the empty string `""` as the payload.
3.  **Return:** The function immediately returns the empty string `""` to the calling script.
4.  **Authentication:** The manager script calls `ns.darknet.authenticate(hostname, "")`. This is the only network call required for this model.
5.  **Verification:** The server's authentication service receives the empty string and matches it against the null-bypass rule.
6.  **Result:** The server returns `true`, granting access. The solver records the success and moves to the next node in the network.
7.  **Post-Action:** The server is now backdoored, and its resources are available for further exploitation.
8.  **Execution:** The solver function `solveZeroLogon()` is called.
9.  **Return:** The function immediately returns the empty string `""`.
10. **Authentication:** The manager script calls `ns.darknet.authenticate(hostname, "")`.
11. **Result:** The server returns `true`, granting access.

#### DarkNet Constraints and Edge Cases

- **Entry Point:** ZeroLogon is always the entry point for the DarkNet. It is the model used by the root node (Depth 0). This is a fixed constant in the DarkNet architecture. Every penetration run begins with this model.
- **No Hint:** Since the solution is always the same, no hint is provided or needed. The absence of a hint is itself a strong indicator that the model is ZeroLogon. If a server provides a hint, it is guaranteed not to be ZeroLogon.
- **Distance:** The root node is always accessible from the DarkWeb root. It serves as the bridge between the public internet and the private DarkNet segments.
- **Depth 0 Exclusivity:** While other models appear at various depths, ZeroLogon is uniquely tied to the initial penetration phase. It cannot be bypassed or skipped.
- **Thread Scaling:** Using multiple threads for ZeroLogon provides no benefit, as the success is binary and immediate. A single thread is sufficient for 100% success.
- **Mutation Immunity:** The root node is generally immune to the mutations that affect deeper segments of the network. Its password and model remain constant throughout the BitNode.
- **No Hint:** Since the solution is always the same, no hint is provided or needed.
- **Distance:** The root node is always accessible from the DarkWeb root.

#### Common Failure Modes

- **Network Latency:** While the algorithm is $O(1)$, the `authenticate` call is still subject to network latency and the `skillFactor`. High latency can make even a trivial login feel slow. In extreme cases, the request might time out before the server responds.
- **Session Expiry:** If the session expires before the command is sent, the authentication will fail. This is common in highly unstable segments of the network or when the player's connection is interrupted.
- **Incorrect Model Identification:** If a server is misidentified as ZeroLogon, the empty string will fail. This can happen if the solver logic is flawed or if the server's metadata is corrupted.
- **Server Migration:** If the server moves to a new coordinate during the authentication attempt, the connection may be dropped. The solver must be able to handle such interruptions and retry the connection.
- **Rate Limiting:** Although rare in the DarkNet, some systems might implement rate limiting on failed attempts. Repeatedly sending empty strings to a non-ZeroLogon server could trigger a lockout.
- **Environment Modification:** If the game's internal constants are modified (e.g., by a script or a mutation), the ZeroLogon bypass might be disabled, though this is not standard behavior.
- **Session Expiry:** If the session expires before the command is sent, the authentication will fail.
- **Incorrect Model Identification:** If a server is misidentified as ZeroLogon, the empty string will fail.

---

### 2. DeskMemo_3.1 (Tier 1)

DeskMemo_3.1 simulates a scenario where sensitive information is leaked through insecure communication channels. This is often referred to as an "echo" vulnerability or "information disclosure." The password is not hidden but is instead embedded within the metadata or hint text provided by the system. This model reflects real-world instances where administrators leave passwords in plain sight, such as on sticky notes (hence the name) or in publicly accessible configuration files. It tests the attacker's ability to parse and extract relevant data from a noisy environment. The challenge lies not in cracking a code, but in identifying the signal within the noise. This model is a classic example of "security through obscurity" failing in the face of basic observation. In the DarkNet, DeskMemo is a Tier 1 model, appearing in the early segments of the network. It serves as a bridge between the trivial ZeroLogon and the more complex algorithmic challenges. The hint provided is usually a sentence or a phrase that ends with the password. The solver's task is to isolate this final token and use it as the credential. This requires basic string manipulation skills and an understanding of how data is presented in the DarkNet interface. It is a reminder that sometimes the answer is right in front of you, provided you know where to look. The model is highly reliable and has a 100% success rate once the hint is captured. It is one of the most efficient ways to progress through the initial layers of the network.

#### Formal CS Problem Statement

Let $H$ be a hint string provided by the server. Let $P$ be the target password. The DeskMemo model guarantees that $P$ is a substring of $H$, specifically located at the end of the string following a known delimiter or pattern.
$$H = S + P$$
where $S$ is a prefix string and $+$ denotes concatenation. The goal is to extract $P$ from $H$. In a more general sense, this is a string parsing problem where the target token is anchored to the end of the input. The prefix $S$ can be of arbitrary length and content, but it always terminates before the password begins. The delimiter is typically a space, a colon, or a specific phrase like "is:". The problem is equivalent to finding the last element in a sequence of tokens. Mathematically, if we define a tokenization function $T(H, \delta)$ that splits $H$ into a sequence of tokens based on delimiter $\delta$, then $P = T(H, \delta)_n$, where $n$ is the index of the final token. This model assumes that the password itself does not contain the delimiter, which is a standard constraint in the DarkNet implementation. The complexity of the problem is linear with respect to the length of the hint string, as the entire string must be scanned to find the final delimiter. This makes it a very efficient problem to solve computationally. The information content of the hint is high, as it contains the exact solution in a clear, albeit slightly obscured, format. The entropy of the password is effectively reduced to zero once the hint is parsed.
$$H = S + P$$
where $S$ is a prefix string and $+$ denotes concatenation. The goal is to extract $P$ from $H$.

#### Optimal Algorithm

The algorithm involves identifying the password token within the hint. In DarkNet, this is typically the last word or a specific token at the end of the hint. The solver must be able to handle variations in the prefix text while consistently isolating the final word. This is achieved by splitting the string into an array of tokens based on whitespace and then selecting the final element of that array. The algorithm is robust and handles most variations of the DeskMemo hint without modification. It is a "one-shot" solver that does not require iteration or feedback from the server.

```pseudocode
function solveDeskMemo(hint):
    // The hint string contains the password at the very end.
    // We trim any leading or trailing whitespace to ensure clean tokenization.
    cleanHint = trim(hint)
    // We split the string by whitespace to isolate the individual tokens.
    // This handles spaces, tabs, and other common delimiters.
    tokens = split(cleanHint, " ")
    // The password is the last token in the resulting array.
    // We access it using the length of the array minus one.
    if length(tokens) > 0:
        password = tokens[length(tokens) - 1]
        // We perform a final check to ensure the token is not empty.
        if length(password) > 0:
            return password
    // If the hint is empty or malformed, return a failure state.
    return failure
```

```pseudocode
function solveDeskMemo(hint):
    // The hint string contains the password at the very end.
    // We split the string by whitespace to isolate the individual tokens.
    tokens = split(hint, " ")

    // The password is the last token in the resulting array.
    // We access it using the length of the array minus one.
    password = tokens[length(tokens) - 1]

    // Return the extracted password.
    return password
```

#### Complexity Analysis

- **Time Complexity:** $O(n)$, where $n$ is the length of the hint string. Splitting the string requires a single pass over the characters to identify delimiters. The subsequent array access is $O(1)$. This makes the solver extremely fast, even for long hints. The time taken scales linearly with the size of the input, which is the optimal complexity for a string parsing problem.
- **Space Complexity:** $O(n)$, to store the tokens generated by the split operation. In the worst case, where every character is a token, the space required is proportional to the input length. This is well within the limits of modern computing environments. The memory is used temporarily during the parsing phase and can be reclaimed immediately after the password is extracted.
- **Parsing Overhead:** While $O(n)$ is efficient, very large hints (though rare in DarkNet) could introduce a minor delay in the parsing phase. The solver should be optimized to handle such cases if they occur.
- **Network Complexity:** $O(1)$. Only a single request is needed to fetch the hint, and a single request is needed to authenticate. This minimizes network traffic and reduces the risk of detection.
- **Space Complexity:** $O(n)$, to store the tokens generated by the split operation.

#### Worked Example: Step-by-Step Execution

1.  **Input Hint:** "The password for this terminal is: hunter2"
2.  **Preprocessing:** The solver receives the hint and trims any accidental whitespace from the ends.
3.  **Tokenization:** The `split` function is called with a space delimiter. The string is broken into the following array:
    - `tokens[0] = "The"`
    - `tokens[1] = "password"`
    - `tokens[2] = "for"`
    - `tokens[3] = "this"`
    - `tokens[4] = "terminal"`
    - `tokens[5] = "is:"`
    - `tokens[6] = "hunter2"`
4.  **Extraction:** The solver identifies `tokens[6]` as the last element in the array.
5.  **Validation:** The solver checks that "hunter2" is a valid, non-empty string.
6.  **Result:** The solver returns "hunter2" to the manager script.
7.  **Authentication:** The manager script calls `ns.darknet.authenticate(hostname, "hunter2")` and receives a success response.
8.  **Post-Action:** Access is granted, and the server is added to the list of controlled nodes.
9.  **Tokenization:** The `split` function is called with a space delimiter.
    - `tokens[0] = "The"`
    - `tokens[1] = "password"`
    - `tokens[2] = "for"`
    - `tokens[3] = "this"`
    - `tokens[4] = "terminal"`
    - `tokens[5] = "is:"`
    - `tokens[6] = "hunter2"`
10. **Extraction:** The solver identifies `tokens[6]` as the last element.
11. **Result:** The solver returns "hunter2".

#### DarkNet Constraints and Edge Cases

- **Trailing Punctuation:** In some cases, the password might be followed by a period or other punctuation. The solver must be robust enough to strip these if necessary, though in DarkNet, the token is usually clean. A regex-based approach can be used for more robust cleaning if the environment becomes noisier.
- **Empty Hint:** If the hint is empty, the algorithm should handle the error gracefully by returning a failure state. This prevents the script from crashing due to an out-of-bounds array access.
- **Multiple Spaces:** The split function should handle multiple consecutive spaces correctly (e.g., by filtering out empty tokens). This ensures that the "last token" is always the actual password and not an empty string.
- **Case Sensitivity:** The extracted password must be sent exactly as it appears in the hint, as most DarkNet systems are case-sensitive. The solver should not modify the case of the extracted token.
- **Encoding:** The hint is typically provided in standard UTF-8. The solver should be able to handle any non-ASCII characters if they are used as part of the password.
- **Hint Truncation:** If the hint is truncated by the network or the UI, the last token may only be a partial password. The solver should check for signs of truncation (e.g., an ellipsis) and handle it accordingly.
- **Empty Hint:** If the hint is empty, the algorithm should handle the error gracefully by returning a failure state.
- **Multiple Spaces:** The split function should handle multiple consecutive spaces correctly (e.g., by filtering out empty tokens).

#### Common Failure Modes

- **Incorrect Delimiter:** If the hint uses a different delimiter than whitespace (e.g., a colon or comma), the split operation might fail to isolate the password, resulting in the entire hint being treated as the password. This will lead to an authentication failure.
- **Pattern Change:** If the password is moved to the middle of the hint or if additional text is appended after the password, the "last token" logic will fail. The solver would need a more sophisticated pattern-matching approach (e.g., regex) to find the password.
- **Noise Injection:** If the hint contains trailing noise after the password (e.g., "password: hunter2 [system log]"), the solver will extract the noise instead of the password.
- **Encoding Issues:** If the hint contains non-standard characters or is encoded in a way the parser doesn't expect, the extraction may result in a corrupted string.
- **Network Interruption:** If the connection is lost while fetching the hint, the solver will receive an empty or partial string, leading to a failure.
- **Model Misidentification:** If a server with a different model is misidentified as DeskMemo, the solver will attempt to parse the hint using the wrong logic, resulting in an incorrect password.
- **Pattern Change:** If the password is moved to the middle of the hint, the "last token" logic will fail.
- **Noise Injection:** If the hint contains trailing noise after the password, the solver will extract the noise instead.

---

### 3. FreshInstall_1.0 (Tier 1)

FreshInstall_1.0 represents the use of default, factory-set credentials. Many systems are deployed with standard passwords like "admin" or "12345" that are never changed by the end-user. This model tests for these common weaknesses, which remain one of the most prevalent security risks in both virtual and physical networks. It emphasizes the "low-hanging fruit" aspect of penetration testing, where simple, well-known values can grant full access to a system. In the DarkNet, this model appears frequently in the early segments, representing newly deployed or poorly maintained nodes. It is a Tier 1 model, requiring no complex computation but rather a simple check against a known list of defaults. The model highlights the human element of security, where convenience often takes precedence over safety. For an attacker, FreshInstall is a gift, providing a quick and easy way to expand their network footprint. The solver for this model is a simple dictionary attack with a very small, fixed search space. It is highly efficient and has a high probability of success on vulnerable nodes. Understanding FreshInstall is about recognizing the patterns of neglect that often plague large-scale network deployments. It is the first thing an automated scanner checks after ZeroLogon, as it provides the highest return on investment for the least amount of effort. In the context of BitNode 15, it is a reliable way to gain access to Tier 1 servers and establish a base of operations for deeper penetration.

#### Formal CS Problem Statement

Let $D = \{d_1, d_2, \dots, d_k\}$ be a finite, static dictionary of common default passwords. The goal is to find $P \in D$ such that $A(P) = True$. In DarkNet, $D$ is exactly `["admin", "password", "0000", "12345"]`. This is a search problem over a very small, discrete space. The probability of success for any single attempt is $1/k$ if the password is chosen uniformly from the set. Since the set is so small, the total search time is negligible. The problem can be viewed as a degenerate case of a dictionary attack where the dictionary is hard-coded and extremely limited. Mathematically, the entropy of the password is $\log_2(k)$, which for $k=4$ is exactly 2 bits. This is an incredibly low level of security. The search space is so small that even with significant network latency, the total time to crack the password is minimal. The problem is equivalent to finding a needle in a very small, well-defined haystack. The information required to solve the problem is entirely contained within the model definition itself, requiring no external hints or data from the target server. This makes it a "blind" attack that is highly effective against unconfigured systems. The simplicity of the problem statement belies its effectiveness in real-world scenarios.

#### Optimal Algorithm

The algorithm is a linear search through the small, fixed dictionary. The solver iterates through each candidate password and attempts to authenticate. The first successful attempt terminates the search. This is a "fail-fast" approach that minimizes the number of network calls. The algorithm is deterministic and guarantees a solution if the password is in the dictionary. It is the most efficient way to handle a small, known search space. The implementation is straightforward and requires no complex data structures or logic.

```pseudocode
function solveFreshInstall():
    // The fixed set of default credentials used in DarkNet.
    // These represent the most common factory settings for Tier 1 servers.
    dictionary = ["admin", "password", "0000", "12345"]
    for each password in dictionary:
        // Attempt authentication with the current candidate.
        // Each call is a separate network request.
        if authenticate(password) == True:
            // If the server accepts the password, we stop and return it.
            return password
    // If none of the candidates work, the model is likely misidentified
    // or the system has been hardened against default credentials.
    return failure
```

```pseudocode
function solveFreshInstall():
    // Define the set of known default credentials.
    dictionary = ["admin", "password", "0000", "12345"]

    // Iterate through each candidate in the dictionary.
    for each password in dictionary:
        // Attempt to authenticate with the current candidate.
        if authenticate(password) == True:
            // If successful, return the password.
            return password

    // If none of the candidates work, return a failure state.
    return failure
```

#### Complexity Analysis

- **Time Complexity:** $O(k)$, where $k$ is the size of the dictionary. Since $k=4$, this is effectively $O(1)$. The number of attempts is capped at a very low constant, making this one of the fastest solvers. The execution time is dominated by the network latency of the authentication calls rather than the local processing time. Even in the worst case, the solver only makes four requests, which is negligible in the context of a full network scan.
- **Space Complexity:** $O(1)$, as the dictionary size is constant and small. The memory required to store the four strings is trivial and does not grow with the complexity of the network. The solver does not need to maintain any complex state or store intermediate results. It is a stateless, lightweight operation.
- **Network Complexity:** $O(k)$. The solver makes at most $k$ network requests. This is a very low overhead and is unlikely to trigger any security alerts or cause significant network congestion. It is a highly efficient way to gain access to a node.
- **Thread Efficiency:** Since the number of attempts is so small, multi-threading is generally not necessary and may even introduce more overhead than it saves. A single thread can complete the search in a fraction of a second.
- **Space Complexity:** $O(1)$, as the dictionary size is constant and small.

#### Worked Example: Step-by-Step Execution

1.  **Initialization:** The solver identifies the model as FreshInstall_1.0 based on the server's metadata or the absence of a specific hint.
2.  **Attempt 1:** The solver selects the first password in the dictionary, "admin", and sends it to the server. The server returns `false`.
3.  **Attempt 2:** The solver selects the second password, "password", and sends it to the server. The server returns `true`.
4.  **Termination:** The solver detects the success and immediately stops the search. It does not attempt the remaining passwords ("0000", "12345").
5.  **Result:** The solver returns "password" to the manager script.
6.  **Verification:** The manager script records the successful penetration and grants access to the server's resources.
7.  **Post-Action:** The server is now backdoored, and the solver moves on to the next target in the network.
8.  **Efficiency Note:** In this example, the solver only required two network calls to find the correct password, demonstrating the efficiency of the linear search on a small dictionary.
9.  **Attempt 1:** The solver tries "admin". The server returns `false`.
10. **Attempt 2:** The solver tries "password". The server returns `true`.
11. **Result:** The solver returns "password".

#### DarkNet Constraints and Edge Cases

- **Fixed Set:** The dictionary is guaranteed to be one of the four specified strings: `["admin", "password", "0000", "12345"]`. Any deviation from this set indicates a different model or a custom configuration. The solver should not attempt any passwords outside of this set.
- **Order:** The order of attempts does not matter for correctness, but trying the most common ones first might save a few milliseconds. In practice, the order is usually "admin", "password", "0000", "12345". This order is based on historical data of the most common default credentials.
- **No Hint Required:** Like ZeroLogon, this model does not provide a hint because the search space is already known and small. The model type itself is the only information needed to solve the problem.
- **Case Sensitivity:** The passwords are case-sensitive and must be provided exactly as defined in the dictionary. The solver should ensure that it sends the strings in lowercase.
- **Thread Scaling:** Using multiple threads for FreshInstall is generally overkill, but it could be used to send all four requests simultaneously if the network latency is very high. However, the sequential approach is usually sufficient.
- **Mutation Resilience:** The FreshInstall model is relatively stable, but a mutation could potentially change the password to a different one within the same set. The solver should be able to re-run the search if a session is lost.
- **Order:** The order of attempts does not matter for correctness, but trying the most common ones first might save a few milliseconds.
- **Case Sensitivity:** The passwords are case-sensitive and must be provided exactly as defined in the dictionary.

#### Common Failure Modes

- **Exhaustion:** If none of the four passwords work, the model is either not FreshInstall or the environment has been modified. This should trigger a fallback to a more general dictionary attack or a manual review of the server's configuration.
- **Rate Limiting:** While not a major factor in DarkNet, repeated failed attempts in a real-world scenario would trigger a lockout. The solver should be aware of any such limits and implement a delay between attempts if necessary.
- **Model Misidentification:** If the solver tries these four passwords on a server with a different model (e.g., one that requires a complex numeric password), it will waste four authentication cycles and fail to gain access.
- **Script Interruption:** If the script is killed between attempts, it must be able to resume from the last tried password to avoid redundant network calls. This requires maintaining a persistent state of the search progress.
- **Network Instability:** If the connection is lost during the sequence of attempts, the solver may need to restart the search from the beginning or from the last successful checkpoint.
- **Encoding Issues:** Ensure the dictionary strings are sent in the correct encoding (usually UTF-8) to avoid any character mismatch on the server side.
- **Rate Limiting:** While not a major factor in DarkNet, repeated failed attempts in a real-world scenario would trigger a lockout.
- **Script Interruption:** If the script is killed between attempts, it must be able to resume from the last tried password.

---

### 4. CloudBlare(tm) (Tier 1)

CloudBlare(tm) is a simplified CAPTCHA (Completely Automated Public Turing test to tell Computers and Humans Apart). It presents a challenge where the "signal" (the password) is obscured by "noise" (filler characters). The goal is to filter out the noise to reveal the underlying password. This model simulates basic anti-bot measures that rely on simple character filtering. It tests the attacker's ability to implement a basic filter or regular expression to isolate specific character classes. In the DarkNet, the signal is always numeric, while the noise consists of alphabetic characters. This clear separation makes the filtering process straightforward but essential. The name is a humorous take on Cloudflare, a popular web security and performance company. In the context of the game, it represents a Tier 1 security layer that is easily bypassed by automated scripts. The model highlights the importance of data sanitization and the risks of relying on weak obfuscation techniques. For an attacker, CloudBlare is a minor hurdle that can be cleared with a single pass over the input data. The solver is highly efficient and provides a 100% success rate once the hint is captured. It is a common model in the early segments of the DarkNet, serving as a test of the player's basic string manipulation capabilities. Understanding CloudBlare is about recognizing the difference between signal and noise in a data stream. It is a fundamental skill in both data science and cybersecurity. In BitNode 15, it is a reliable way to gain access to Tier 1 and Tier 2 servers, providing a steady stream of new nodes for the player's network. The model is stable and predictable, making it an ideal target for early-game automation.

#### Formal CS Problem Statement

Let $H$ be a hint string consisting of characters from a set $\Sigma$. Let $\Sigma_{signal} \subset \Sigma$ be the set of valid password characters (in this case, digits `[0-9]`). Let $\Sigma_{noise} = \Sigma \setminus \Sigma_{signal}$ be the set of filler characters. The goal is to construct a string $P$ such that $P$ consists only of the characters in $H$ that belong to $\Sigma_{signal}$, in their original relative order. This is a projection operation from the space of all strings over $\Sigma$ to the space of strings over $\Sigma_{signal}$. The relative order of the signal characters is preserved, which is a critical property of the transformation. The problem can be solved by a single pass over the input string, making it highly efficient. Mathematically, if we define a filter function $F(c)$ such that $F(c) = c$ if $c \in \Sigma_{signal}$ and $F(c) = \epsilon$ otherwise, then $P = F(H_1) + F(H_2) + \dots + F(H_n)$. The entropy of the password is reduced to the entropy of the signal characters within the hint. Since the signal characters are explicitly provided, the search space is reduced to a single point. The complexity of the problem is $O(n)$, where $n$ is the length of the hint string. This is the optimal complexity for any algorithm that must process the entire input. The problem is a classic example of data extraction from a noisy channel. It demonstrates that even with significant noise, the signal can be recovered perfectly if the filtering criteria are known. In the DarkNet, the filtering criteria are fixed (digits only), making the problem trivial to solve once identified.

#### Optimal Algorithm

Iterate through the hint string and append any character that is a digit to a new string. This can be implemented using a simple loop or a regular expression that replaces all non-digit characters with an empty string. The loop-based approach is often more transparent and easier to debug in a pseudocode context. The algorithm is a "one-shot" solver that does not require iteration or feedback from the server. It is highly efficient and handles hints of any length.

```pseudocode
function solveCloudBlare(hint):
    // Initialize an empty string to store the extracted digits.
    // This will become the final password.
    password = ""
    // Iterate through each character in the hint string from left to right.
    for each char in hint:
        // Check if the character is a numeric digit (0-9).
        // This is the filtering criteria for the CloudBlare model.
        if isDigit(char):
            // If it is a digit, append it to the password string.
            // The relative order of digits is preserved.
            password = password + char
    // Return the resulting string of digits.
    // If no digits were found, this will be an empty string.
    return password
```

```pseudocode
function solveCloudBlare(hint):
    // Initialize an empty string to store the extracted digits.
    password = ""

    // Iterate through each character in the hint string.
    for each char in hint:
        // Check if the character is a digit (0-9).
        if isDigit(char):
            // If it is a digit, append it to the password string.
            password = password + char

    // Return the resulting string of digits.
    return password
```

#### Complexity Analysis

- **Time Complexity:** $O(n)$, where $n$ is the length of the hint string. We visit each character exactly once to perform the digit check. The complexity is linear with respect to the input size, which is the optimal complexity for this type of problem. The time taken scales predictably with the length of the hint, ensuring consistent performance across different servers.
- **Space Complexity:** $O(n)$, to store the resulting password string. In the worst case, where the entire hint is composed of digits, the output string will be the same length as the input. The memory usage is minimal and is only required during the extraction process. The resulting string is typically much shorter than the hint, further reducing the actual space required.
- **Efficiency:** This is an extremely efficient solver, as it requires no complex data structures or recursive calls. It is well-suited for high-speed automation and can process thousands of hints per second. The primary bottleneck is the network latency of fetching the hint and sending the password, rather than the local processing time.
- **Network Complexity:** $O(1)$. Only a single request is needed to fetch the hint, and a single request is needed to authenticate. This makes it a very low-overhead attack.
- **Space Complexity:** $O(n)$, to store the resulting password string.

#### Worked Example: Step-by-Step Execution

1.  **Input Hint:** "a1b2c3d4e5"
2.  **Initialization:** The solver creates an empty string `password = ""`.
3.  **Iteration 1:** The solver examines 'a'. It is not a digit. The solver skips it.
4.  **Iteration 2:** The solver examines '1'. It is a digit. The solver appends it: `password = "1"`.
5.  **Iteration 3:** The solver examines 'b'. It is not a digit. The solver skips it.
6.  **Iteration 4:** The solver examines '2'. It is a digit. The solver appends it: `password = "12"`.
7.  **Iteration 5:** The solver examines 'c'. It is not a digit. The solver skips it.
8.  **Iteration 6:** The solver examines '3'. It is a digit. The solver appends it: `password = "123"`.
9.  **Iteration 7:** The solver examines 'd'. It is not a digit. The solver skips it.
10. **Iteration 8:** The solver examines '4'. It is a digit. The solver appends it: `password = "1234"`.
11. **Iteration 9:** The solver examines 'e'. It is not a digit. The solver skips it.
12. **Iteration 10:** The solver examines '5'. It is a digit. The solver appends it: `password = "12345"`.
13. **Termination:** The solver reaches the end of the hint string.
14. **Result:** The solver returns "12345" to the manager script.
15. **Authentication:** The manager script calls `ns.darknet.authenticate(hostname, "12345")` and receives a success response.
16. **Post-Action:** Access is granted, and the server is backdoored.
17. **Iteration 1:** 'a' is not a digit. Skip.
18. **Iteration 2:** '1' is a digit. `password = "1"`.
19. **Iteration 3:** 'b' is not a digit. Skip.
20. **Iteration 4:** '2' is a digit. `password = "12"`.
21. **Iteration 5:** 'c' is not a digit. Skip.
22. **Iteration 6:** '3' is a digit. `password = "123"`.
23. **Iteration 7:** 'd' is not a digit. Skip.
24. **Iteration 8:** '4' is a digit. `password = "1234"`.
25. **Iteration 9:** 'e' is not a digit. Skip.
26. **Iteration 10:** '5' is a digit. `password = "12345"`.
27. **Result:** The solver returns "12345".

#### DarkNet Constraints and Edge Cases

- **Only Digits:** The signal is always composed of digits in the current DarkNet implementation. This simplifies the filtering logic significantly, as the solver only needs to check for a single character class.
- **No Digits:** If the hint contains no digits, the password is an empty string. The solver should handle this case without error and return `""`. This is a valid, albeit rare, edge case.
- **Mixed Noise:** The noise can consist of any non-digit characters, including symbols, whitespace, or non-ASCII characters. The `isDigit` check must be robust enough to handle these and correctly identify only the numeric digits.
- **Hint Length:** Hints can vary in length, but the $O(n)$ complexity ensures that even long hints are processed quickly. The solver should be able to handle hints of several thousand characters if necessary.
- **Case Sensitivity:** Since the signal is numeric, case sensitivity is not an issue for the password itself. However, the filtering logic must be consistent and not be affected by the case of the noise characters.
- **Thread Scaling:** Like other Tier 1 models, multi-threading is not necessary for CloudBlare. A single thread can process the hint and authenticate in a fraction of a second.
- **Mutation Resilience:** The CloudBlare model is stable, but a mutation could change the hint string. The solver should fetch a fresh hint before each authentication attempt to ensure it has the latest data.
- **No Digits:** If the hint contains no digits, the password is an empty string (though this is unlikely in practice).
- **Large Hints:** The hint string can be quite long, but the $O(n)$ complexity ensures it is processed quickly.

#### Common Failure Modes

- **Non-Digit Signal:** If the model were to change to include letters as signal, the `isDigit` check would fail. A more flexible approach using a whitelist of allowed characters or a regular expression would be safer for future-proofing.
- **Large Hints:** Very long hints could increase the processing time, though $O(n)$ remains efficient. In extreme cases, this could lead to a timeout if the network is slow or the player's CPU is heavily loaded.
- **Regex Errors:** If using a regular expression, an incorrect pattern (e.g., one that strips digits instead of noise) will result in an incorrect password and an authentication failure.
- **Encoding Issues:** If the digits are represented in a non-standard encoding (e.g., full-width Unicode digits), the standard `isDigit` check might fail. The solver should be aware of the character encoding used by the server.
- **Noise Mimicry:** If the noise characters include digits that are not part of the password (e.g., "a1b2c3d4e5 [v1.0]"), the algorithm will fail by including the extra digits. However, in the current DarkNet, all digits in the hint are part of the password.
- **Network Interruption:** If the connection is lost while fetching the hint, the solver will receive an empty or partial string, leading to an incorrect password.
- **Model Misidentification:** If a server with a different model is misidentified as CloudBlare, the solver will attempt to extract digits from a hint that might require a different logic, resulting in failure.
- **Encoding Issues:** If the digits are represented in a non-standard encoding (e.g., full-width Unicode digits), the `isDigit` check might fail.
- **Noise Mimicry:** If the noise characters include digits that are not part of the password, the algorithm will fail.

---

### 5. Laika4 (Tier 2)

Laika4 is a domain-specific dictionary attack. It simulates a scenario where a user has chosen a password based on a common theme—in this case, popular dog names. This is a step up from FreshInstall as the dictionary is slightly larger and themed. It represents a more targeted approach to password cracking, where knowledge of the user's preferences or the system's context can be used to narrow down the search space. In the DarkNet, this model is often found on servers with a more "personal" or "informal" feel. The name "Laika" is a nod to the famous Soviet space dog, further reinforcing the theme. The number "4" in the name refers to the size of the dictionary used in the current implementation. This model highlights the vulnerability of using predictable, themed passwords. Even if the theme is known, the specific choice within that theme must be determined through trial and error. The search space is small enough that a linear scan is the optimal strategy. For an attacker, Laika4 is a Tier 2 model, requiring a bit more effort than Tier 1 but still being highly automated. The solver is reliable and provides a 100% success rate once the model is identified. It is a common model in the mid-segments of the DarkNet, representing servers that have some level of custom configuration but still rely on weak passwords. Understanding Laika4 is about recognizing the patterns of human behavior that lead to predictable security choices. It is a classic example of how social engineering or contextual knowledge can be used to bypass technical security measures. In BitNode 15, it is a reliable way to gain access to Tier 2 servers and expand the player's network into more secure segments. The model is stable and predictable, making it an ideal target for mid-game automation.

#### Formal CS Problem Statement

Let $D_{dog}$ be a set of common dog names. In the DarkNet implementation, this set is exactly `["fido", "spot", "rover", "max"]`. The goal is to find $P \in D_{dog}$ such that $A(P) = True$. This is a search problem over a small, themed dictionary. The size of the dictionary is fixed at 4 entries, making the search extremely fast. The problem highlights the vulnerability of using predictable, themed passwords. Even if the theme is known, the specific choice within that theme must be determined through trial and error. The search space is small enough that a linear scan is the optimal strategy. Mathematically, the entropy of the password is $\log_2(k)$, where $k=4$ is the number of names in the dictionary. This corresponds to 2 bits of entropy, which is extremely low. The probability of success for any single attempt is $1/k$, and the expected number of attempts to find the correct password is $(k+1)/2 = 2.5$. This makes the attack highly efficient and predictable. The information required to solve the problem is entirely contained within the model definition, requiring no external hints from the target server. This is a "blind" dictionary attack that targets a specific, well-defined theme. The simplicity of the problem statement belies its effectiveness in scenarios where users choose passwords based on common categories. In the DarkNet, the theme is always dog names, and the list is always the same four entries. This makes the model a trivial target for automation once identified.

#### Optimal Algorithm

Iterate through the fixed list of 4 dog names. The solver attempts to authenticate with each name in sequence until a match is found. This is a straightforward implementation of a dictionary attack. The algorithm is deterministic and guarantees a solution if the password is in the dictionary. It is the most efficient way to handle a small, known search space. The implementation is simple and requires no complex logic or data structures.

```pseudocode
function solveLaika4():
    // The specific set of dog names used in DarkNet.
    // These represent the most common themed passwords for Tier 2 servers.
    // The list is fixed at 4 entries: fido, spot, rover, max.
    names = ["fido", "spot", "rover", "max"]
    // Iterate through each name in the list from first to last.
    for each name in names:
        // Attempt to authenticate with the current dog name.
        // Each call is a separate network request.
        if authenticate(name) == True:
            // If the server accepts the name, we stop and return it.
            return name
    // If none of the names work, the model is likely misidentified
    // or the system has been hardened against this specific theme.
    return failure
```

```pseudocode
function solveLaika4():
    // Define the set of common dog names used as passwords.
    names = ["fido", "spot", "rover", "max", "buddy", "rex", "duke", "bear", "lucky", "rocky"]

    // Iterate through each name in the list.
    for each name in names:
        // Attempt to authenticate with the current name.
        if authenticate(name) == True:
            // If successful, return the name.
            return name

    // If none of the names work, return a failure state.
    return failure
```

#### Complexity Analysis

- **Time Complexity:** $O(k)$, where $k=4$. This is constant time. The number of attempts is fixed and very small, ensuring a quick resolution. The execution time is dominated by the network latency of the authentication calls rather than the local processing time. Even in the worst case, the solver only makes four requests, which is negligible in the context of a full network scan. The time taken is independent of the password length or the server's depth.
- **Space Complexity:** $O(1)$, as the list size is fixed. The memory required to store the four names is minimal and does not scale with any input parameters. The solver does not need to maintain any complex state or store intermediate results. It is a stateless, lightweight operation that is highly efficient in resource-constrained environments.
- **Network Complexity:** $O(k)$. The solver makes at most $k$ network requests. This is a very low overhead and is unlikely to trigger any security alerts or cause significant network congestion. It is a highly efficient way to gain access to a node.
- **Thread Efficiency:** Since the number of attempts is so small, multi-threading is generally not necessary. A single thread can complete the search in a fraction of a second. However, if network latency is extremely high, all four requests could be sent in parallel to minimize the total time.
- **Space Complexity:** $O(1)$, as the list size is fixed.

1.  **Initialization:** The solver identifies the model as Laika4 based on the server's metadata or the absence of a specific hint.
2.  **Attempt 1:** The solver selects the first name in the list, "fido", and sends it to the server. The server returns `false`.
3.  **Attempt 2:** The solver selects the second name, "spot", and sends it to the server. The server returns `false`.
4.  **Attempt 3:** The solver selects the third name, "rover", and sends it to the server. The server returns `true`.
5.  **Termination:** The solver detects the success and immediately stops the search. It does not attempt the remaining name ("max").
6.  **Result:** The solver returns "rover" to the manager script.
7.  **Verification:** The manager script records the successful penetration and grants access to the server's resources.
8.  **Post-Action:** The server is now backdoored, and the solver moves on to the next target in the network.
9.  **Efficiency Note:** In this example, the solver required three network calls to find the correct password, which is close to the expected average of 2.5 attempts.
10. **Initialization:** The solver is invoked for a Laika4 server.
11. **Attempt 1:** "fido". Server returns `false`.
12. **Attempt 2:** "spot". Server returns `false`.
13. **Attempt 3:** "rover". Server returns `true`.
14. **Result:** The solver returns "rover".

#### DarkNet Constraints and Edge Cases

- **Case Sensitivity:** The names are typically lowercase in the DarkNet implementation. The solver should ensure it sends the names in the correct case (e.g., "fido" instead of "Fido").
- **Fixed List:** The list is exactly 4 entries long: `["fido", "spot", "rover", "max"]`. Any other dog names (e.g., "buddy", "rex") are not part of this model in the current version of the game.
- **No Hint:** Like other Tier 1 and 2 models, Laika4 does not provide a hint, as the search space is predefined and small. The model type itself is the only information needed.
- **Theme Consistency:** The model always uses dog names; it never switches to other animals or themes. This predictability is what makes it so easy to automate.
- **Thread Scaling:** Using multiple threads for Laika4 is generally overkill, but it could be used to send all four requests simultaneously if the network latency is very high.
- **Mutation Resilience:** The Laika4 model is stable, but a mutation could potentially change the password to a different one within the same set. The solver should be able to re-run the search if a session is lost.
- **Depth Range:** Laika4 typically appears in the Tier 2 segments of the network (Depth 2-8). It is a step up from the Tier 1 models found at the perimeter.
- **Fixed List:** The list is exactly 10 entries long.
- **Theme Consistency:** The model is guaranteed to use one of these 10 names.

#### Common Failure Modes

- **Missing Name:** If the password is a dog name not in the list (e.g., "buddy"), the attack fails. This would indicate a change in the game's constants or a different model that uses a larger dictionary.
- **Authentication Delay:** With 4 attempts, the total time taken is $4 \times \text{authTime}$. While small, this is still more than a Tier 1 solver. In a high-latency environment, this delay can become noticeable.
- **Model Misidentification:** Trying dog names on a server that requires a numeric password or a different theme will result in wasted attempts and failure to gain access.
- **Network Instability:** If the connection is lost during the sequence of attempts, the solver may need to restart the search from the beginning or from the last successful checkpoint.
- **Script Interruption:** If the script is killed between attempts, it must be able to resume from the last tried name to avoid redundant network calls.
- **Encoding Issues:** Ensure the names are sent in the correct encoding (usually UTF-8) to avoid any character mismatch on the server side.
- **Rate Limiting:** Although rare, if the server implements rate limiting, the solver should add a delay between attempts to avoid being locked out.
- **Authentication Delay:** With 10 attempts, the total time taken is $10 \times \text{authTime}$.
- **Incorrect Model:** If the server is not Laika4, the dictionary will be useless.

---

### 6. NIL (Tier 2)

NIL is a sophisticated side-channel attack simulation. It provides character-by-character feedback, allowing an attacker to determine the correctness of each position in the password independently. This reduces the search space from exponential to linear. This model represents a critical vulnerability where a system leaks information about the internal state of its authentication process. Instead of a simple "yes/no" for the entire password, the system reveals which specific characters are correct. This is akin to a "timing attack" or a "debugging interface" that was left active in production. It is one of the most powerful models for an attacker, as it guarantees a solution in a predictable amount of time. The name "NIL" might refer to the null-terminated strings in C or the concept of a null pointer, hinting at the low-level nature of the vulnerability. In the DarkNet, NIL is a Tier 2 model, appearing as the player moves deeper into the network. It tests the player's ability to implement an iterative search that builds a solution piece by piece. The model is highly reliable and provides a 100% success rate once the oracle is accessed. It is a classic example of how a small information leak can completely compromise a system's security. For an attacker, NIL is a high-value target, as it allows them to crack complex passwords that would be impossible to brute-force. Understanding NIL is about recognizing the power of side-channel information and how it can be used to decompose a large problem into smaller, manageable parts. In BitNode 15, it is a key tool for penetrating the mid-tier segments of the network, providing access to servers with significant RAM and compute resources. The model is stable and predictable, making it an ideal target for mid-game automation. It is a reminder that the security of a system is only as strong as its weakest information leak.

#### Formal CS Problem Statement

Let $P$ be a password of length $L$. Let $O(i, c)$ be an oracle function that returns $True$ if the character at position $i$ in the password is $c$, and $False$ otherwise. The goal is to reconstruct $P$ by querying $O$ for all $i \in [0, L-1]$ and $c \in \Sigma$, where $\Sigma$ is the character set. This is a search problem over a product space $\Sigma^L$, but the oracle allows us to decompose it into $L$ independent searches over $\Sigma$. The total number of queries is reduced from $|\Sigma|^L$ to $L \times |\Sigma|$. This is a massive reduction in complexity, transforming an intractable problem into a trivial one. Mathematically, the entropy of the password is $L \log_2(|\Sigma|)$, but the oracle reduces the effective entropy to $\log_2(|\Sigma|)$ per position. The total effort required is linear with respect to the password length, rather than exponential. The oracle provides a "gradient" that points directly to the correct character at each position, allowing the solver to converge on the solution with 100% certainty. The information gain from each query is $\log_2(|\Sigma|)$ bits if the query is successful, and a smaller amount if it fails. The optimal strategy is to iterate through the charset for each position until the oracle returns `True`. This ensures that each position is solved in at most $|\Sigma|$ queries. The total number of queries is bounded by $L \times |\Sigma|$, which is a very small number for typical password lengths and charsets. This model demonstrates the devastating impact of position-based feedback on password security. It is a fundamental concept in cryptanalysis and side-channel attacks.

#### Optimal Algorithm

For each position in the password, iterate through the character set until the oracle confirms the correct character. The solver builds the password one character at a time, moving to the next position only after the current one is correctly identified. This is a greedy approach that is guaranteed to find the optimal solution because each position is independent. The algorithm is highly efficient and handles passwords of any length.

```pseudocode
function solveNIL(passwordLength):
    // Initialize an array to store the discovered characters.
    // This allows us to build the password piece by piece.
    password = array of length passwordLength
    // The standard alphanumeric charset used in DarkNet.
    // This includes lowercase letters and digits.
    charset = "abcdefghijklmnopqrstuvwxyz0123456789"
    // Iterate through each position in the password from left to right.
    for i from 0 to passwordLength - 1:
        // For each position, try every character in the charset.
        for each char in charset:
            // Query the oracle for the character at the current index.
            // This is the side-channel leak that we are exploiting.
            if oracle(i, char) == "yes":
                // If the oracle returns "yes", we've found the correct character.
                password[i] = char
                // Move to the next position immediately.
                // This is the key to the linear-time complexity.
                break
    // Join the characters into a single string and return it.
    return join(password)
```

```pseudocode
function solveNIL(passwordLength):
    // Initialize an array to store the discovered characters.
    password = array of length passwordLength

    // Define the character set to search through.
    charset = "abcdefghijklmnopqrstuvwxyz0123456789"

    // Iterate through each position in the password.
    for i from 0 to passwordLength - 1:
        // For each position, try every character in the charset.
        for each char in charset:
            // Query the oracle for the current position and character.
            if oracle(i, char) == "yes":
                // If the oracle returns "yes", we've found the correct character.
                password[i] = char
                // Move to the next position.
                break

    // Join the characters into a single string and return it.
    return join(password)
```

#### Complexity Analysis

- **Time Complexity:** $O(L \times |\Sigma|)$, where $L$ is the password length and $|\Sigma|$ is the size of the character set. This is linear with respect to the length of the password, making it extremely efficient even for long passwords. The time taken scales predictably with both $L$ and $|\Sigma|$, ensuring consistent performance. The average number of queries is $L \times |\Sigma| / 2$, which is a very small number for typical DarkNet passwords.
- **Space Complexity:** $O(L)$, to store the characters of the password as they are discovered. The memory usage is minimal and scales linearly with the password length. The solver does not need to maintain any complex data structures or store a large number of intermediate results. It is a lightweight, memory-efficient operation.
- **Query Efficiency:** The number of calls to the oracle is the primary factor in the solver's performance. Each call is a separate network request, so the total time is dominated by network latency. The linear complexity ensures that the number of requests remains manageable even for complex passwords.
- **Network Complexity:** $O(L \times |\Sigma|)$. The solver makes a series of network requests to the oracle. While more than Tier 1 models, it is still very efficient compared to a brute-force attack. The solver should be optimized to handle network latency and potential timeouts.
- **Space Complexity:** $O(L)$, to store the characters of the password as they are discovered.

#### Worked Example: Step-by-Step Execution

1.  **Initialization:** The solver determines the password length is 3 based on the hint provided by the server.
2.  **Position 0:**
    - The solver tries 'a': The oracle returns "no".
    - The solver tries 'b': The oracle returns "no".
    - The solver tries 'c': The oracle returns "yes". The solver sets `password[0] = 'c'`.
3.  **Position 1:**
    - The solver tries 'a': The oracle returns "yes". The solver sets `password[1] = 'a'`.
4.  **Position 2:**
    - The solver tries 'a': The oracle returns "no".
    - The solver tries 'b': The oracle returns "no".
    - ...
    - The solver tries 't': The oracle returns "yes". The solver sets `password[2] = 't'`.
5.  **Termination:** The solver has found characters for all 3 positions.
6.  **Result:** The solver joins the characters and returns "cat" to the manager script.
7.  **Verification:** The manager script calls `ns.darknet.authenticate(hostname, "cat")`. The server accepts the password and grants access.
8.  **Post-Action:** The server is backdoored, and its resources are added to the player's pool.
9.  **Efficiency Note:** In this example, the solver required only a few queries per position, demonstrating the power of the side-channel attack.
10. **Position 0:**
    - Try 'a': "no"
    - Try 'b': "no"
    - Try 'c': "yes" -> `password[0] = 'c'`
11. **Position 1:**
    - Try 'a': "yes" -> `password[1] = 'a'`
12. **Position 2:**
    - Try 'a': "no"
    - ...
    - Try 't': "yes" -> `password[2] = 't'`
13. **Result:** The solver returns "cat".

#### DarkNet Constraints and Edge Cases

- **Feedback Format:** The feedback is usually a string like "yes" or "no" for a specific index. The solver must parse this string correctly and handle any variations in the response format.
- **Charset:** The charset is typically alphanumeric (lowercase letters and digits). If the password contains other characters (e.g., symbols or uppercase letters), the solver must be updated to include them in its search.
- **Length Discovery:** The password length is usually provided in the hint or can be determined by probing the server. The solver must have the correct length to function properly.
- **Index Range:** The oracle uses 0-based indexing for the character positions. The solver must ensure it queries all indices from 0 to $L-1$.
- **Synchronous Queries:** Each query to the oracle is a separate network call. The solver should be designed to handle the cumulative latency of these calls.
- **Thread Scaling:** While the search is linear, multiple threads could be used to query different positions in parallel, further reducing the total cracking time. However, the sequential approach is usually fast enough.
- **Mutation Resilience:** The NIL model is stable, but a mutation could change the password or the length. The solver should re-verify the length and restart the search if a session is lost.
- **Depth Range:** NIL typically appears in the Tier 2 and Tier 3 segments of the network (Depth 4-16). It represents a significant step up in security from the perimeter models.
- **Charset:** The charset is typically alphanumeric.
- **Length Discovery:** The password length is usually provided in the hint.

#### Common Failure Modes

- **Unknown Charset:** If the password contains characters outside the expected set (e.g., symbols, spaces, or uppercase letters), the inner loop will never find a match for that position, leading to an infinite loop or a failure.
- **Length Mismatch:** If the assumed password length is incorrect, the algorithm will either fail to find all characters or will attempt to find characters at non-existent positions, resulting in an incorrect password.
- **Oracle Failure:** If the oracle becomes unavailable or returns inconsistent results (e.g., due to a mutation or a server restart), the solver will fail to reconstruct the password.
- **Timeout:** For very long passwords and large charsets, the total number of queries might exceed the time limit for a single authentication session. The solver should be optimized for speed and handle potential timeouts gracefully.
- **Network Latency:** High network latency can significantly increase the total time required to crack the password, as each query is a separate network call.
- **Off-by-One Errors:** Errors in the indexing logic (e.g., starting at 1 instead of 0 or stopping at $L$ instead of $L-1$) will result in a malformed password.
- **Incorrect Feedback Interpretation:** Misinterpreting the oracle's response (e.g., treating "no" as "yes") will lead to an incorrect password and authentication failure.
- **Length Mismatch:** If the assumed password length is incorrect, the algorithm will fail to reconstruct the full string.
- **Oracle Latency:** Each query to the oracle might take time, making the total cracking time significant for long passwords.

---

### 7. Pr0verFl0 (Tier 2)

Pr0verFl0 simulates a buffer overflow vulnerability. In low-level programming, failing to check the bounds of a buffer can allow an attacker to overwrite adjacent memory. In this model, the "authentication" is bypassed by overflowing the input buffer.

#### Formal CS Problem Statement

Let $B$ be a buffer of size $L$. The system expects an input of length $L$. However, providing an input of length $2L$ causes the internal state to be overwritten such that the authentication check is bypassed. The only constraint is that the overflow characters must not be a specific "null" or "terminator" character (in this case, "■").

#### Optimal Algorithm

Construct a string of length $2 \times \text{password\_length}$ using any valid character (e.g., 'A').

```pseudocode
function solvePr0verFl0(passwordLength):
    // The goal is to overflow the input buffer to bypass authentication.
    // We construct a string that is twice the expected length.
    overflowString = repeat("A", 2 * passwordLength)

    // Return the overflow string.
    return overflowString
```

#### Complexity Analysis

- **Time Complexity:** $O(L)$, where $L$ is the password length. Constructing the string takes linear time.
- **Space Complexity:** $O(L)$, to store the overflow string.

#### Worked Example: Step-by-Step Execution

1.  **Initialization:** The server expects an 8-character password.
2.  **Action:** The solver calculates the overflow length: $8 \times 2 = 16$.
3.  **Construction:** The solver creates a string of 16 'A's: "AAAAAAAAAAAAAAAA".
4.  **Result:** The solver returns the overflow string, and the server grants access.

#### DarkNet Constraints and Edge Cases

- **Forbidden Character:** The character "■" must be avoided as it likely acts as a terminator that prevents the overflow.
- **Multiplier:** The overflow must be exactly or at least $2 \times$ the expected length.
- **Buffer Size:** The expected length $L$ is provided in the hint.

#### Common Failure Modes

- **Insufficient Length:** If the string is too short, the overflow won't reach the target memory area.
- **Character Filtering:** If the system filters out the chosen character, the attack will fail.
- **Terminator Collision:** If the chosen character happens to be the terminator for this specific system.

---

### 8. PHP 5.4 (Tier 3)

PHP 5.4 represents a more complex challenge involving permutations and a distance-based feedback mechanism. It is named after an era of web development known for quirky behaviors and specific vulnerabilities.

#### Formal CS Problem Statement

Given a set of digits $S = \{d_1, d_2, \dots, d_n\}$, find the correct permutation $P$ of $S$. The server provides feedback in the form of the Root Mean Square Deviation (RMSD) between the guess $G$ and the actual password $P$:
$$RMSD(G, P) = \sqrt{\frac{1}{n}\sum_{i=1}^{n}(G_i - P_i)^2}$$
where $G_i$ and $P_i$ are the digits at position $i$.

#### Mathematical Foundation

The RMSD is a measure of the average distance between the elements of two vectors. In this context, it provides a "gradient" that can be followed to find the correct permutation. Since the digits are known, the problem is reduced to finding the correct ordering.

#### Optimal Algorithm

Since the search space is $n!$, a brute-force approach is only feasible for small $n$. However, the RMSD provides a continuous metric that can guide a search algorithm like Hill Climbing or Simulated Annealing. Alternatively, a backtracking algorithm with pruning can be used.

```pseudocode
function solvePHP54(sortedDigits):
    // Start with the sorted digits as the initial guess.
    currentPermutation = sortedDigits
    minRMSD = getRMSD(currentPermutation)

    // Continue searching as long as the RMSD is greater than zero.
    while minRMSD > 0:
        improved = false
        // Try all possible swaps of two elements.
        for i from 0 to n-1:
            for j from i+1 to n-1:
                nextPermutation = swap(currentPermutation, i, j)
                currentRMSD = getRMSD(nextPermutation)

                // If the swap reduces the RMSD, accept it.
                if currentRMSD < minRMSD:
                    minRMSD = currentRMSD
                    currentPermutation = nextPermutation
                    improved = true
                    break
            if improved: break

        // If no swap improves the RMSD, we might be at a local minimum.
        if not improved:
            // Handle local minimum (e.g., by random restart or backtracking).
            break

    return currentPermutation
```

#### Complexity Analysis

- **Time Complexity:** $O(n!)$ in the worst case, but the RMSD heuristic typically reduces this to $O(n^2)$ or $O(n^3)$ iterations.
- **Space Complexity:** $O(n)$, to store the current permutation.

#### Worked Example: Step-by-Step Execution

1.  **Digits:** {1, 2, 3}
2.  **Initial Guess:** "123", RMSD = 0.816
3.  **Swap (1, 2):** "132", RMSD = 0.408 (Improvement!)
4.  **Swap (2, 3):** "312", RMSD = 1.22 (Worse)
5.  **Swap (1, 3):** "231", RMSD = 0 (Found it!)
6.  **Result:** The solver returns "231".

#### DarkNet Constraints and Edge Cases

- **Digits Only:** The password is always a permutation of the provided digits.
- **Precision:** The RMSD is a floating-point number; comparisons should account for small epsilon values.
- **Duplicate Digits:** The algorithm must handle cases where the set $S$ contains duplicate digits.

#### Common Failure Modes

- **Local Minima:** Hill climbing can get stuck in local minima. Using multiple restarts or a more robust search (like backtracking) is recommended.
- **Large $n$:** If the password is very long, the permutation space becomes prohibitively large.
- **Floating Point Errors:** Precision issues when comparing RMSD values.

---

### 9. DeepGreen (Tier 3)

DeepGreen is a classic Mastermind-style game. It requires logical deduction based on two types of feedback: exact matches and misplaced characters.

#### Formal CS Problem Statement

Let $P$ be a secret code of length $L$ using characters from a set $\Sigma$. A guess $G$ returns a pair $(E, M)$, where:

- $E$ (Exact): The number of positions $i$ such that $G_i = P_i$.
- $M$ (Misplaced): The number of characters in $G$ that appear in $P$ but at different positions, excluding those already counted in $E$.
  The goal is to find $P$ in the minimum number of guesses.

#### Optimal Algorithm

Knuth's Five-Guess Algorithm is a well-known strategy for $L=4, |\Sigma|=6$. For the general case, an information-theoretic approach that selects the guess maximizing the expected reduction in the set of possible codes is optimal.

```pseudocode
function solveDeepGreen(charset, length):
    // Generate all possible codes given the charset and length.
    possibleCodes = generateAllCodes(charset, length)

    while length(possibleCodes) > 1:
        // Select the guess that provides the most information.
        guess = selectBestGuess(possibleCodes)

        // Get feedback from the server for the chosen guess.
        feedback = getFeedback(guess)

        // Filter the set of possible codes based on the feedback.
        possibleCodes = filter(possibleCodes, guess, feedback)

    // Return the remaining code.
    return possibleCodes[0]

function filter(codes, guess, feedback):
    // Keep only the codes that would produce the same feedback if they were the secret.
    return [c for c in codes if getFeedback(c, guess) == feedback]
```

#### Complexity Analysis

- **Time Complexity:** $O(|\Sigma|^L)$ to generate the initial set. Filtering is $O(N)$ where $N$ is the number of remaining codes.
- **Space Complexity:** $O(|\Sigma|^L)$, which can be large (e.g., $10^6$ for $L=6, |\Sigma|=10$).

#### Worked Example: Step-by-Step Execution

1.  **Secret:** "1234"
2.  **Guess 1:** "1122", Feedback: (1, 1)
3.  **Filter:** Keep only codes that would give (1, 1) if the secret were "1122".
4.  **Guess 2:** "1345", Feedback: (1, 2)
5.  **Filter:** Further reduce the set.
6.  **Final Guess:** "1234", Feedback: (4, 0)
7.  **Result:** The solver returns "1234".

#### DarkNet Constraints and Edge Cases

- **Standard Rules:** Follows the standard Mastermind logic.
- **Large Search Space:** For high difficulty, the number of possible codes can exceed RAM limits if not handled carefully (e.g., using a lazy filter).
- **Charset Variety:** The charset can include digits, letters, or symbols.

#### Common Failure Modes

- **Memory Exhaustion:** Storing all possible codes for large $L$ and $|\Sigma|$.
- **Inefficient Guessing:** Random guessing will take much longer than an optimized strategy.
- **Feedback Parsing:** Errors in parsing the (Exact, Misplaced) tuple from the server response.

---

### 10. BellaCuore (Tier 3)

BellaCuore combines binary search with Roman numeral representation. It tests the ability to map a non-standard encoding to a linear domain where binary search is applicable.

#### Formal CS Problem Statement

The password is an integer $X \in [1, N]$ represented as a Roman numeral. The server provides feedback:

- "ALTUS": The guess $G > X$.
- "PARUM": The guess $G < X$.
  The goal is to find $X$ using $O(\log N)$ queries.

#### Optimal Algorithm

Perform a standard binary search in the integer domain. Convert each integer guess to its Roman numeral equivalent before sending it to the server.

```pseudocode
function solveBellaCuore(maxRange):
    // Initialize the search bounds.
    low = 1
    high = maxRange

    while low <= high:
        // Calculate the midpoint of the current range.
        mid = floor((low + high) / 2)

        // Convert the integer midpoint to a Roman numeral.
        romanGuess = toRoman(mid)

        // Send the Roman numeral guess to the server.
        feedback = authenticate(romanGuess)

        if feedback == "CORRECT":
            // If correct, return the Roman numeral.
            return romanGuess
        else if feedback == "ALTUS":
            // If the guess is too high, adjust the upper bound.
            high = mid - 1
        else if feedback == "PARUM":
            // If the guess is too low, adjust the lower bound.
            low = mid + 1

    return failure
```

#### Complexity Analysis

- **Time Complexity:** $O(\log N \times \text{cost}(\text{toRoman}))$. Binary search is logarithmic, and Roman numeral conversion is linear with respect to the number of digits.
- **Space Complexity:** $O(1)$, as we only store the bounds and the current guess.

#### Worked Example: Step-by-Step Execution

1.  **Range:** [1, 100], Target: 42 (XLII)
2.  **Guess 1:** 50 (L), Feedback: "ALTUS" -> Range: [1, 49]
3.  **Guess 2:** 25 (XXV), Feedback: "PARUM" -> Range: [26, 49]
4.  **Guess 3:** 37 (XXXVII), Feedback: "PARUM" -> Range: [38, 49]
5.  **Guess 4:** 43 (XLIII), Feedback: "ALTUS" -> Range: [38, 42]
6.  **Guess 5:** 40 (XL), Feedback: "PARUM" -> Range: [41, 42]
7.  **Guess 6:** 41 (XLI), Feedback: "PARUM" -> Range: [42, 42]
8.  **Guess 7:** 42 (XLII), Feedback: "CORRECT"
9.  **Result:** The solver returns "XLII".

#### DarkNet Constraints and Edge Cases

- **Roman Numeral Limits:** Standard Roman numerals only go up to 3999 (MMMCMXCIX). If the range is larger, a non-standard extension (like vinculum) might be needed, though DarkNet usually stays within standard limits.
- **Zero:** Roman numerals have no representation for zero.
- **Case Sensitivity:** Roman numerals are typically uppercase.

#### Common Failure Modes

- **Incorrect Conversion:** Errors in the `toRoman` or `fromRoman` logic.
- **Off-by-One Errors:** Standard binary search pitfalls.
- **Range Mismatch:** If the initial `maxRange` is too small, the target will never be found.

---

### 11. AccountsManager_4.2 (Tier 3)

AccountsManager_4.2 is a straightforward integer binary search. It represents a common debugging or administrative interface that leaks information about the target value through comparison feedback.

#### Formal CS Problem Statement

Find an integer $X \in [0, N]$ given feedback "Higher" or "Lower".

#### Optimal Algorithm

Standard binary search.

```pseudocode
function solveAccountsManager(maxRange):
    // Initialize the search bounds.
    low = 0
    high = maxRange

    while low <= high:
        // Calculate the midpoint.
        mid = floor((low + high) / 2)

        // Send the integer guess to the server.
        feedback = authenticate(mid)

        if feedback == "CORRECT":
            // If correct, return the integer.
            return mid
        else if feedback == "Higher":
            // If the target is higher, adjust the lower bound.
            low = mid + 1
        else if feedback == "Lower":
            // If the target is lower, adjust the upper bound.
            high = mid - 1

    return failure
```

#### Complexity Analysis

- **Time Complexity:** $O(\log N)$.
- **Space Complexity:** $O(1)$.

#### Worked Example: Step-by-Step Execution

1.  **Range:** [0, 1000], Target: 750
2.  **Guess 1:** 500, Feedback: "Higher" -> [501, 1000]
3.  **Guess 2:** 750, Feedback: "CORRECT"
4.  **Result:** The solver returns 750.

#### DarkNet Constraints and Edge Cases

- **Range:** The maximum value $N$ is typically provided in the hint or can be inferred from the difficulty.
- **Integer Domain:** The target is always a whole number.

#### Common Failure Modes

- **Infinite Loop:** If the feedback is inconsistent or the range is not correctly updated.
- **Overflow:** If $N$ is extremely large, `(low + high)` might overflow before the division.
- **Incorrect Feedback Interpretation:** Swapping the logic for "Higher" and "Lower".

---

### 12. OctantVoxel (Tier 3)

OctantVoxel tests the ability to perform base conversion. This is a fundamental CS skill, often used in data encoding, memory addressing, and cryptography.

#### Formal CS Problem Statement

Given a number $V$ in base $B_{in}$, convert it to base $B_{out}$. In DarkNet, this usually means converting from a given base (e.g., binary, octal, hexadecimal) to decimal (base 10).

#### Optimal Algorithm

Use the positional notation formula:
$$Value = \sum_{i=0}^{L-1} d_i \times B^i$$
where $d_i$ is the digit at position $i$ (starting from the right) and $B$ is the base.

```pseudocode
function solveOctantVoxel(valueStr, base):
    // Initialize the decimal value.
    decimalValue = 0
    power = 0

    // Iterate through the string from right to left.
    for i from length(valueStr) - 1 down to 0:
        // Convert the character to its numeric value.
        digit = charToValue(valueStr[i])

        // Add the digit's contribution to the total.
        decimalValue = decimalValue + digit * (base ^ power)

        // Increment the power for the next position.
        power = power + 1

    // Return the decimal value as a string.
    return toString(decimalValue)
```

#### Complexity Analysis

- **Time Complexity:** $O(L)$, where $L$ is the number of digits in the input string.
- **Space Complexity:** $O(1)$ (excluding the output string).

#### Worked Example: Step-by-Step Execution

1.  **Input:** "1011", Base: 2
2.  **Calculation:**
    - $1 \times 2^0 = 1$
    - $1 \times 2^1 = 2$
    - $0 \times 2^2 = 0$
    - $1 \times 2^3 = 8$
    - Total: $1 + 2 + 0 + 8 = 11$
3.  **Result:** The solver returns "11".

#### DarkNet Constraints and Edge Cases

- **Bases:** Can range from 2 to 36 (using A-Z for digits 10-35).
- **Large Numbers:** Ensure the integer type can handle the resulting decimal value.
- **Case Sensitivity:** Letters used as digits (A-Z) are typically case-insensitive.

#### Common Failure Modes

- **Incorrect Digit Mapping:** Mapping 'A' to 10, 'B' to 11, etc.
- **Overflow:** The decimal value exceeding the maximum safe integer.
- **Invalid Characters:** The input string containing characters not valid for the given base.

---

### 13. Factori-Os (Tier 3)

Factori-Os involves finding the factors of a given integer. This is a core problem in number theory and forms the basis of many cryptographic algorithms (like RSA).

#### Formal CS Problem Statement

Given an integer $n$, find all positive integers $d$ such that $n \pmod d = 0$.

#### Optimal Algorithm

Trial division up to $\sqrt{n}$. For each $d \in [1, \sqrt{n}]$, if $d$ divides $n$, then both $d$ and $n/d$ are factors.

```pseudocode
function solveFactoriOs(n):
    // Initialize an empty list to store the factors.
    factors = []

    // Iterate from 1 up to the square root of n.
    for d from 1 to sqrt(n):
        // Check if d is a divisor of n.
        if n % d == 0:
            // If it is, add d to the list.
            append(factors, d)

            // Also add the corresponding factor n/d, if it's different.
            if d != n / d:
                append(factors, n / d)

    // Sort the factors in ascending order and return the list.
    return sort(factors)
```

#### Complexity Analysis

- **Time Complexity:** $O(\sqrt{n})$.
- **Space Complexity:** $O(\text{number of factors})$, which is typically small ($O(n^{1/3})$ on average).

#### Worked Example: Step-by-Step Execution

1.  **Input:** 28
2.  **Iteration 1:** $d=1$. $28\%1=0 \rightarrow$ Factors: {1, 28}
3.  **Iteration 2:** $d=2$. $28\%2=0 \rightarrow$ Factors: {1, 28, 2, 14}
4.  **Iteration 3:** $d=3$. $28\%3=1$. Skip.
5.  **Iteration 4:** $d=4$. $28\%4=0 \rightarrow$ Factors: {1, 28, 2, 14, 4, 7}
6.  **Iteration 5:** $d=5$. $28\%5=3$. Stop ($5 > \sqrt{28}$).
7.  **Result:** The solver returns [1, 2, 4, 7, 14, 28].

#### DarkNet Constraints and Edge Cases

- **Format:** The answer might be the sum of factors, the count of factors, or the list itself.
- **Perfect Squares:** Handle the case where $d = n/d$ to avoid duplicate factors.
- **Large $n$:** For very large $n$, trial division is still efficient enough for DarkNet.

#### Common Failure Modes

- **Efficiency:** Using trial division up to $n$ instead of $\sqrt{n}$ for large $n$.
- **Missing Factors:** Forgetting to include $n/d$ when $d$ is found.
- **Sorting:** Failing to return the factors in the expected order.

---

### 14. OpenWebAccessPoint (Tier 3)

OpenWebAccessPoint is a unique model that doesn't require a direct algorithmic solution in the traditional sense. Instead, it represents a vulnerable node that leaks information about other nodes in the network.

#### Formal CS Problem Statement

The node acts as a "packet sniffer." It has a high vulnerability multiplier ($8\times$) which increases the rate at which it captures credentials from the network. The capture rate is defined by:
$$Rate = 0.18 \times \text{vuln} \times 0.88^{(\text{difficulty} \times 1.3)}$$
The goal is to maintain a connection to this node to passively accumulate passwords.

#### Optimal Algorithm

Deploy a long-running script on the node that monitors the "packet stream" and parses out credentials.

```pseudocode
function runSniffer():
    // This script runs indefinitely on the target server.
    while true:
        // Capture the next packet from the network stream.
        packet = capturePacket()

        // Check if the packet contains a credential pair.
        if packet contains "hostname:password":
            // Extract the hostname and password and store them in the database.
            extractAndStore(packet)

        // Wait for a short interval before capturing the next packet.
        wait(interval)
```

#### Complexity Analysis

- **Time Complexity:** $O(1)$ per packet processed.
- **Space Complexity:** $O(1)$ (excluding the database of captured passwords).

#### Worked Example: Step-by-Step Execution

1.  **Action:** Connect to an `OpenWebAccessPoint` server.
2.  **Observation:** After 5 minutes, a packet is captured: "...noise... server-alpha:p4ssw0rd ...noise..."
3.  **Result:** The solver extracts "server-alpha" and "p4ssw0rd" and adds them to the central database.

#### DarkNet Constraints and Edge Cases

- **Vulnerability:** The $8\times$ multiplier makes this the most efficient way to get passwords for deep-tier servers.
- **Decay:** As difficulty increases, the rate drops significantly, making it less effective for the deepest nodes.
- **Persistence:** The sniffer must be restarted if the server is rebooted by a mutation.

#### Common Failure Modes

- **Script Termination:** If the script is killed (e.g., by a mutation), sniffing stops.
- **Buffer Overflow:** If too many packets are captured without being processed.
- **Parsing Errors:** Failing to correctly identify the hostname and password within the noisy packet.

---

### 15. KingOfTheHill (Tier 3)

KingOfTheHill is an optimization problem. It simulates finding the peak of a signal or a "hill" in a mathematical landscape.

#### Formal CS Problem Statement

Find the value $x$ that maximizes a unimodal function $f(x)$ (specifically a Gaussian). Each query to the server returns $f(x)$ for a given $x$.

#### Optimal Algorithm

Ternary search is ideal for unimodal functions. It repeatedly divides the search space into three parts and discards the part that cannot contain the maximum.

```pseudocode
function solveKingOfTheHill(low, high, epsilon):
    // Perform ternary search to find the maximum of a unimodal function.
    while (high - low) > epsilon:
        // Divide the range into three equal parts.
        m1 = low + (high - low) / 3
        m2 = high - (high - low) / 3

        // Compare the function values at the two midpoints.
        if f(m1) < f(m2):
            // The maximum must be in the right two-thirds.
            low = m1
        else:
            // The maximum must be in the left two-thirds.
            high = m2

    // Return the average of the final bounds.
    return (low + high) / 2
```

#### Complexity Analysis

- **Time Complexity:** $O(\log_{1.5}(1/\epsilon))$, where $\epsilon$ is the desired precision.
- **Space Complexity:** $O(1)$.

#### Worked Example: Step-by-Step Execution

1.  **Range:** [0, 100], Target Peak: 72.5
2.  **Iteration 1:** $m1=33.3, m2=66.6$. $f(33.3) < f(66.6) \rightarrow$ Range: [33.3, 100]
3.  **Iteration 2:** $m1=55.5, m2=77.7$. $f(55.5) < f(77.7) \rightarrow$ Range: [55.5, 100]
4.  **Iteration 3:** $m1=70.3, m2=85.1$. $f(70.3) > f(85.1) \rightarrow$ Range: [55.5, 85.1]
5.  **Result:** The solver converges to 72.5.

#### DarkNet Constraints and Edge Cases

- **Gaussian:** The function is guaranteed to be a Gaussian, which is perfectly unimodal.
- **Precision:** The server might require a specific number of decimal places.
- **Range:** The initial range [0, 100] is usually sufficient.

#### Common Failure Modes

- **Non-Unimodal Functions:** If the function had multiple peaks, ternary search would fail.
- **Step Size:** If the initial range is too small, the peak might be missed.
- **Query Limit:** If the server limits the number of guesses.

---

### 16. RateMyPix.Auth (Tier 3)

RateMyPix.Auth is a variation of the NIL model but with less granular feedback. Instead of knowing _which_ character is correct, you only know _how many_ are correct.

#### Formal CS Problem Statement

Let $P$ be a password of length $L$. A guess $G$ returns a count $C = \sum_{i=0}^{L-1} [G_i = P_i]$, where $[condition]$ is the Iverson bracket (1 if true, 0 if false). The goal is to find $P$.

#### Optimal Algorithm

Start with an initial guess (e.g., all 'a's). Change one character at a time. If the count increases, the new character is correct. If it decreases, the previous character was correct. If it stays the same, neither was correct.

```pseudocode
function solveRateMyPix(length):
    // Initialize the password with a default character.
    password = repeat("a", length)
    currentCount = getCount(password)
    charset = "abcdefghijklmnopqrstuvwxyz0123456789"

    // Iterate through each position in the password.
    for i from 0 to length - 1:
        originalChar = password[i]
        // Try each character in the charset for the current position.
        for each char in charset:
            if char == originalChar: continue

            password[i] = char
            newCount = getCount(password)

            if newCount > currentCount:
                // If the count increased, we found the correct character.
                currentCount = newCount
                break
            else if newCount < currentCount:
                // If the count decreased, the original character was correct.
                password[i] = originalChar
                break
            // If the count stayed the same, continue to the next character.

    return password
```

#### Complexity Analysis

- **Time Complexity:** $O(L \times |\Sigma|)$.
- **Space Complexity:** $O(L)$.

#### Worked Example: Step-by-Step Execution

1.  **Secret:** "cat", Initial Guess: "aaa", Count: 1 (the 'a' in the middle)
2.  **Position 0:**
    - Try 'b': "baa", Count: 1 (no change)
    - Try 'c': "caa", Count: 2 (increase!) -> `password[0] = 'c'`
3.  **Position 1:**
    - Try 'b': "cba", Count: 1 (decrease!) -> `password[1] = 'a'` (revert)
4.  **Position 2:**
    - Try 'b': "cab", Count: 2 (no change)
    - ...
    - Try 't': "cat", Count: 3 (increase!) -> `password[2] = 't'`
5.  **Result:** The solver returns "cat".

#### DarkNet Constraints and Edge Cases

- **Emoji Feedback:** The count is provided as a string of pepper emojis (🌶). The solver must count the emojis.
- **Initial Count:** If the initial guess has zero correct characters, the logic still holds.
- **Charset:** The charset is typically alphanumeric.

#### Common Failure Modes

- **Incorrect Counting:** Failing to correctly parse the number of emojis.
- **Reversion Logic:** Forgetting to revert the character when the count decreases.
- **Charset Exhaustion:** If the character is not in the charset.

---

### 17. PrimeTime 2 (Tier 4)

PrimeTime 2 moves into the realm of computational number theory, specifically the problem of integer factorization.

#### Formal CS Problem Statement

Given a large integer $n$, find its largest prime factor $p$.

#### Optimal Algorithm

Trial division is sufficient for the numbers typically encountered in DarkNet. Divide $n$ by 2 until it's odd, then by odd numbers starting from 3 up to $\sqrt{n}$.

```pseudocode
function solvePrimeTime2(n):
    // Initialize the maximum prime factor.
    maxPrime = -1

    // Remove all factors of 2.
    while n % 2 == 0:
        maxPrime = 2
        n = n / 2

    // Check odd divisors starting from 3.
    d = 3
    while d * d <= n:
        while n % d == 0:
            maxPrime = d
            n = n / d
        d = d + 2

    // If n is still greater than 1, then n itself is prime.
    if n > 1:
        maxPrime = n

    return maxPrime
```

#### Complexity Analysis

- **Time Complexity:** $O(\sqrt{n})$ in the worst case (when $n$ is a product of two large primes).
- **Space Complexity:** $O(1)$.

#### Worked Example: Step-by-Step Execution

1.  **Input:** 13195
2.  **Calculation:**
    - $13195 / 5 = 2639$
    - $2639 / 7 = 377$
    - $377 / 13 = 29$
    - 29 is prime.
3.  **Result:** The solver returns 29.

#### DarkNet Constraints and Edge Cases

- **Large $n$:** For very large $n$, trial division might be slow. Pollard's rho algorithm could be used as an alternative.
- **Prime $n$:** If $n$ is prime, the answer is $n$.
- **Format:** The answer is a single integer.

#### Common Failure Modes

- **Timeout:** If $n$ is extremely large and the algorithm is inefficient.
- **Non-Prime Factors:** Returning a composite factor instead of a prime one.
- **Precision:** Using standard floating-point numbers for very large integers.

---

### 18. TopPass (Tier 4)

TopPass is a large-scale dictionary attack using the most common passwords found in real-world data breaches.

#### Formal CS Problem Statement

Let $D_{top}$ be a dictionary of approximately 90 common passwords (e.g., "123456", "password", "qwerty"). Find $P \in D_{top}$ such that $A(P) = True$.

#### Optimal Algorithm

Linear search through the dictionary.

```pseudocode
function solveTopPass():
    // Load the dictionary of common passwords.
    dictionary = loadDictionary("top_passwords.txt")

    // Iterate through each password in the dictionary.
    for each password in dictionary:
        // Attempt to authenticate with the current password.
        if authenticate(password) == True:
            // If successful, return the password.
            return password

    return failure
```

#### Complexity Analysis

- **Time Complexity:** $O(k)$, where $k \approx 90$.
- **Space Complexity:** $O(k)$, to store the dictionary.

#### Worked Example: Step-by-Step Execution

1.  **Attempt 1:** "123456". Result: False.
2.  **Attempt 2:** "password". Result: False.
3.  **...**
4.  **Attempt 42:** "iloveyou". Result: True.
5.  **Result:** The solver returns "iloveyou".

#### DarkNet Constraints and Edge Cases

- **Static List:** The list is fixed within the game's logic.
- **Time:** 90 attempts can take significant time if `authTime` is high.
- **Case Sensitivity:** Passwords must match the dictionary exactly.

#### Common Failure Modes

- **Incomplete Dictionary:** If the solver's dictionary is missing the target password.
- **Rate Limiting:** (Not applicable in DarkNet).
- **Incorrect Model:** If the server is not TopPass.

---

### 19. EuroZone Free (Tier 4)

EuroZone Free is another domain-specific dictionary attack, this time focusing on the member states of the European Union.

#### Formal CS Problem Statement

Let $D_{EU}$ be the set of the 27 EU member countries. Find $P \in D_{EU}$ such that $A(P) = True$.

#### Optimal Algorithm

Linear search through the list of EU countries.

```pseudocode
function solveEuroZone():
    // Define the list of EU member states.
    countries = ["Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden"]

    // Iterate through each country in the list.
    for each country in countries:
        // Attempt to authenticate with the country name.
        if authenticate(country) == True:
            // If successful, return the country name.
            return country

    return failure
```

#### Complexity Analysis

- **Time Complexity:** $O(27)$.
- **Space Complexity:** $O(1)$.

#### Worked Example: Step-by-Step Execution

1.  **Attempt 1:** "Austria". Result: False.
2.  **...**
3.  **Attempt 10:** "France". Result: True.
4.  **Result:** The solver returns "France".

#### DarkNet Constraints and Edge Cases

- **Case Sensitivity:** Usually requires proper capitalization or all lowercase.
- **Brexit:** Ensure the list does not include the United Kingdom.
- **Spelling:** Names must be spelled correctly (e.g., "Czech Republic").

#### Common Failure Modes

- **Outdated List:** Using a list that includes non-EU countries or excludes new members.
- **Case Mismatch:** Providing "france" when the server expects "France".
- **Incorrect Model:** If the server is not EuroZone Free.

---

### 20. 2G_cellular (Tier 4)

2G_cellular simulates a classic timing attack where the system leaks the position of the first incorrect character. This is a devastating side-channel that allows for linear-time cracking.

#### Formal CS Problem Statement

Let $P$ be the secret password. A guess $G$ returns an index $i$ such that $G[0 \dots i-1] = P[0 \dots i-1]$ and $G[i] \neq P[i]$. If $G = P$, it returns a success indicator.

#### Optimal Algorithm

Build the password character by character. For each position, try characters until the returned index increases.

```pseudocode
function solve2GCellular():
    // Initialize the password and the current mismatch index.
    password = ""
    currentIndex = 0
    charset = "abcdefghijklmnopqrstuvwxyz0123456789"

    while true:
        // Try each character in the charset for the next position.
        for each char in charset:
            guess = password + char
            resultIndex = getMismatchIndex(guess)

            if resultIndex > currentIndex:
                // If the mismatch index increased, we found the correct character.
                password = password + char
                currentIndex = resultIndex
                break
            else if resultIndex == -1:
                // If the result is -1, the guess was correct.
                return guess
```

#### Complexity Analysis

- **Time Complexity:** $O(L \times |\Sigma|)$.
- **Space Complexity:** $O(L)$.

#### Worked Example: Step-by-Step Execution

1.  **Secret:** "hack"
2.  **Guess "a":** Index 0 (Mismatch at pos 0)
3.  **...**
4.  **Guess "h":** Index 1 (Mismatch at pos 1) -> `password = "h"`
5.  **Guess "ha":** Index 2 (Mismatch at pos 2) -> `password = "ha"`
6.  **Guess "hac":** Index 3 (Mismatch at pos 3) -> `password = "hac"`
7.  **Guess "hack":** Success!
8.  **Result:** The solver returns "hack".

#### DarkNet Constraints and Edge Cases

- **Index Format:** The index is usually 0-based.
- **Empty Password:** Handle the case where the password might be empty.
- **Charset:** The charset is typically alphanumeric.

#### Common Failure Modes

- **Off-by-One:** Misinterpreting the returned index.
- **Charset Exhaustion:** If the character is not in the charset.
- **Index Reset:** If the server resets the index on every guess (not the case here).

---

### 21. 110100100 (Tier 4)

110100100 involves decoding binary-encoded ASCII text. This is a common way to obscure data in transit or storage.

#### Formal CS Problem Statement

Given a string of bits $S \in \{0, 1\}^*$, where each block of 8 bits represents an ASCII character, decode $S$ into its corresponding text.

#### Optimal Algorithm

Split the string into 8-bit chunks, convert each chunk to its decimal value, and then to the ASCII character.

```pseudocode
function solve110100100(bitString):
    // Initialize the resulting text string.
    text = ""

    // Iterate through the bit string in 8-bit steps.
    for i from 0 to length(bitString) - 1 step 8:
        // Extract an 8-bit chunk.
        chunk = substring(bitString, i, 8)

        // Convert the binary chunk to a decimal integer.
        decimal = binaryToDecimal(chunk)

        // Convert the decimal integer to its ASCII character.
        char = asciiToChar(decimal)

        // Append the character to the text.
        text = text + char

    return text
```

#### Complexity Analysis

- **Time Complexity:** $O(L)$, where $L$ is the number of bits.
- **Space Complexity:** $O(L/8)$, to store the resulting string.

#### Worked Example: Step-by-Step Execution

1.  **Input:** "0110100001101001"
2.  **Chunk 1:** "01101000" -> 104 -> 'h'
3.  **Chunk 2:** "01101001" -> 105 -> 'i'
4.  **Result:** The solver returns "hi".

#### DarkNet Constraints and Edge Cases

- **Padding:** Ensure the bit string length is a multiple of 8.
- **Encoding:** Standard 8-bit ASCII (or UTF-8 for the first 127 characters).
- **Bit Order:** Most-significant bit first (MSB).

#### Common Failure Modes

- **Incorrect Chunking:** Splitting at the wrong intervals.
- **Base Conversion Errors:** Errors in the binary-to-decimal logic.
- **Non-ASCII Bits:** If the bits represent something other than ASCII.

---

### 22. MathML (Tier 4)

MathML requires evaluating arithmetic expressions that use non-standard Unicode operators and may contain malicious code injection.

#### Formal CS Problem Statement

Evaluate a string expression $E$ containing numbers and operators $\{ҳ, ÷, ➕, ➖\}$. The expression may also contain non-mathematical substrings that must be ignored or sanitized.

#### Optimal Algorithm

1.  **Sanitization:** Remove any characters that are not digits, decimal points, or the allowed operators.
2.  **Normalization:** Replace Unicode operators with standard ones (`*`, `/`, `+`, `-`).
3.  **Evaluation:** Use the Shunting-yard algorithm to convert to Reverse Polish Notation (RPN) and then evaluate, or use a safe expression evaluator.

```pseudocode
function solveMathML(expression):
    // Normalization: Replace Unicode operators with standard ones.
    expression = replace(expression, "ҳ", "*")
    expression = replace(expression, "÷", "/")
    expression = replace(expression, "➕", "+")
    expression = replace(expression, "➖", "-")

    // Sanitization: Remove any non-mathematical characters.
    // This prevents code injection traps like "ns.exit();".
    expression = sanitize(expression, "[0-9+\-*/(). ]")

    // Evaluate the sanitized expression using standard precedence rules.
    return evaluate(expression)
```

#### Complexity Analysis

- **Time Complexity:** $O(L)$, where $L$ is the length of the expression.
- **Space Complexity:** $O(L)$, for the operator stack and RPN queue.

#### Worked Example: Step-by-Step Execution

1.  **Input:** "ns.exit(); 10 ➕ 5 ҳ 2"
2.  **Sanitization:** "10 ➕ 5 ҳ 2"
3.  **Normalization:** "10 + 5 \* 2"
4.  **Evaluation:** $10 + (5 \times 2) = 20$
5.  **Result:** The solver returns "20".

#### DarkNet Constraints and Edge Cases

- **Operator Precedence:** Multiplication and division take precedence over addition and subtraction.
- **Injection:** The "ns.exit();" or similar traps are common and must be stripped.
- **Parentheses:** The expression may contain parentheses to override precedence.

#### Common Failure Modes

- **Unsafe Eval:** Using `eval()` directly on the unsanitized string, which would trigger the traps.
- **Precedence Errors:** Evaluating $10 + 5 \times 2$ as $15 \times 2 = 30$.
- **Division by Zero:** Handling cases where the expression results in division by zero.

---

### 23. OrdoXenos (Tier 4)

OrdoXenos is a bitwise XOR cipher challenge. XOR is a fundamental operation in cryptography because it is its own inverse.

#### Formal CS Problem Statement

Given an encrypted string $C$ and a key $K$, find the plaintext $P$ such that $P = C \oplus K$. In DarkNet, the hint often contains the encrypted text and the binary mask bits.

#### Optimal Algorithm

Apply the XOR operation between each character of the ciphertext and the corresponding character of the key.

```pseudocode
function solveOrdoXenos(ciphertext, key):
    // Initialize the plaintext string.
    plaintext = ""

    // Iterate through each character of the ciphertext.
    for i from 0 to length(ciphertext) - 1:
        // Get the numeric code for the current ciphertext character.
        charC = charCodeAt(ciphertext, i)

        // Get the numeric code for the corresponding key character.
        // The key is cycled if it is shorter than the ciphertext.
        charK = charCodeAt(key, i % length(key))

        // Perform the bitwise XOR operation.
        // P = C ^ K
        plaintext = plaintext + fromCharCode(charC ^ charK)

    return plaintext
```

#### Complexity Analysis

- **Time Complexity:** $O(L)$, where $L$ is the length of the ciphertext.
- **Space Complexity:** $O(L)$.

#### Worked Example: Step-by-Step Execution

1.  **Ciphertext:** [72, 101, 108, 108, 111] ("Hello")
2.  **Key:** [1, 2, 3, 4, 5]
3.  **XOR:**
    - $72 \oplus 1 = 73$ ('I')
    - $101 \oplus 2 = 103$ ('g')
    - ...
4.  **Result:** The solver returns the decrypted string.

#### DarkNet Constraints and Edge Cases

- **Key Reuse:** The key might be shorter than the ciphertext and need to be cycled.
- **Binary Mask:** The key might be provided as a string of bits.
- **Encoding:** Standard character encoding (UTF-16).

#### Common Failure Modes

- **Incorrect Key Alignment:** Misaligning the key with the ciphertext.
- **Encoding Issues:** Errors in converting between characters and their numeric codes.
- **Key Discovery:** Failing to correctly extract the key from the hint.

---

### 24. BigMo%od (Tier 4)

BigMo%od is a mathematical challenge based on the Chinese Remainder Theorem (CRT). It involves solving a system of simultaneous congruences.

#### Formal CS Problem Statement

Find the smallest non-negative integer $x$ such that:
$x \equiv a_1 \pmod{m_1}$
$x \equiv a_2 \pmod{m_2}$
$x \equiv a_3 \pmod{m_3}$
where $m_i$ are pairwise coprime.

#### Optimal Algorithm

Use the constructive method for CRT.

1.  Calculate $M = m_1 \times m_2 \times m_3$.
2.  For each $i$, calculate $M_i = M / m_i$.
3.  Find $y_i$ such that $M_i y_i \equiv 1 \pmod{m_i}$ using the Extended Euclidean Algorithm.
4.  The solution is $x = \sum (a_i M_i y_i) \pmod M$.

```pseudocode
function solveBigMood(a, m):
    // Calculate the product of all moduli.
    M = m[0] * m[1] * m[2]
    x = 0

    // Iterate through each equation.
    for i from 0 to 2:
        // Calculate the partial product.
        Mi = M / m[i]

        // Find the modular multiplicative inverse.
        yi = modularInverse(Mi, m[i])

        // Add the term to the total sum.
        x = x + a[i] * Mi * yi

    // Return the result modulo M.
    return x % M
```

#### Complexity Analysis

- **Time Complexity:** $O(k \log m)$, where $k=3$ and $\log m$ is the complexity of the Extended Euclidean Algorithm.
- **Space Complexity:** $O(1)$.

#### Worked Example: Step-by-Step Execution

1.  **Equations:**
    - $x \equiv 2 \pmod 3$
    - $x \equiv 3 \pmod 5$
    - $x \equiv 2 \pmod 7$
2.  **Calculation:**
    - $M = 3 \times 5 \times 7 = 105$
    - $M_1 = 35, M_2 = 21, M_3 = 15$
    - $y_1 = 2, y_2 = 1, y_3 = 1$
    - $x = (2 \times 35 \times 2) + (3 \times 21 \times 1) + (2 \times 15 \times 1) = 140 + 63 + 30 = 233$
    - $233 \pmod{105} = 23$
3.  **Result:** The solver returns 23.

#### DarkNet Constraints and Edge Cases

- **Coprimality:** The moduli $m_i$ are guaranteed to be pairwise coprime.
- **Large Numbers:** Intermediate products can be very large; use BigInt if necessary.
- **Exactly Three:** The system always consists of exactly three equations.

#### Common Failure Modes

- **Modular Inverse Error:** Failing to find the correct $y_i$.
- **Overflow:** Integer overflow during the summation.
- **Input Parsing:** Errors in extracting $a_i$ and $m_i$ from the hint.

---

### Overarching CS Problems

Beyond the individual authentication models, the DarkNet presents several high-level architectural and algorithmic challenges that span the entire network.

#### Graph Traversal in Dynamic Networks

The DarkNet is not a static graph. It is a $40 \times 8$ grid where nodes and edges are constantly in flux.

**CS Mapping:** Dynamic Graph Algorithms / Online Pathfinding.

**Problem Analysis:**
The network topology mutates approximately every 30 seconds per row of depth. A mutation can involve:

- **Server Migration:** A server moves to a new (x, y) coordinate.
- **Connection Shuffling:** Edges between servers are added or removed.
- **Server Restart:** A server goes offline and comes back with a new password.
- **Server Deletion/Addition:** Nodes are removed from or added to the grid.

This means that a path found at time $t$ may no longer exist at time $t+1$. Standard algorithms like Dijkstra or A\* must be adapted for this volatility.

**Strategy: Reactive Pathfinding**
Instead of calculating a long-term path, the system should use a "next-hop" approach combined with frequent re-scanning.

```pseudocode
function navigateTo(target):
    while currentPos != target:
        // Scan the local neighborhood for connections.
        scanNeighbors()

        // If the target is directly connected, move to it.
        if target is neighbor:
            move(target)
            return

        // Otherwise, find the best next hop towards the target.
        nextHop = findBestNextHop(target)

        if nextHop exists:
            // Move to the next hop.
            move(nextHop)
        else:
            // If no path exists, wait for the next mutation.
            wait(mutation)
```

**State Machine Diagram:**

1.  **IDLE:** Waiting for a target.
2.  **SCANNING:** Mapping local connections.
3.  **PATHFINDING:** Calculating the shortest path to the target.
4.  **MOVING:** Executing the first step of the path.
5.  **VERIFYING:** Checking if the path is still valid. If not, return to SCANNING.

#### Air Gap Crossing

The DarkNet is physically partitioned by "air gaps" at rows 8, 16, 24, and 32. No servers can be placed on these rows, creating a disconnect between the segments of the grid.

**CS Mapping:** Connectivity in Partitioned Graphs / Side-Channel Jumps.

**Problem Analysis:**
A standard `scan()` will never reveal a server across an air gap because there are no physical connections. To cross the gap, one must exploit the game's mechanics.

**Strategy 1: Migration Exploitation**
During a mutation, there is a 30% chance that a server will move. If a server from row 7 moves to row 9, it effectively "jumps" the gap. If you have a session on that server, you can now access the next segment.

**Strategy 2: Information Leaks (The "Sniffing Jump")**
The `OpenWebAccessPoint` model and the Clue System can provide passwords for servers that are not physically connected to your current segment. Since `connectToSession(hostname, password)` is a global, synchronous operation that does not require a physical path, you can use these leaked credentials to "teleport" across the gap.

```pseudocode
function crossAirGap(currentDepth):
    targetDepth = currentDepth + 2
    while true:
        // Check database for any known passwords at targetDepth.
        if db.hasPasswordAtDepth(targetDepth):
            hostname, password = db.getPasswordAtDepth(targetDepth)
            // Use the global connection command to jump the gap.
            connectToSession(hostname, password)
            return

        // Monitor the network for servers migrating across the gap.
        monitorMigration(currentDepth, targetDepth)

        // Wait for the next mutation cycle.
        wait(30s)
```

#### Labyrinth Navigation

The Labyrinth is the final challenge of the DarkNet, located at the deepest level. It is a series of 7 progressive mazes.

**CS Mapping:** Online Maze Exploration / Partial Observability.

**Problem Analysis:**
The player has only a $3 \times 3$ local view of the maze. The global structure is unknown, and the exit must be found to progress to the next lab. The maze is a grid where the player moves 2 cells per step (representing moving through a cell and the wall between cells).

**Strategy: Incremental Mapping with DFS**
Use a Depth-First Search (DFS) combined with a coordinate-based map to track visited cells and walls.

```pseudocode
function solveLabyrinth():
    // Initialize the map and the exploration stack.
    map = new Map()
    stack = [(1, 1)]
    visited = Set((1, 1))

    while stack not empty:
        curr = stack.peek()

        // Capture the 3x3 local view.
        view = look()

        // Update the global map with the new information.
        updateMap(curr, view)

        // Check if the current cell is the exit.
        if isExit(curr):
            return success

        // Find an unvisited neighbor that is not blocked by a wall.
        nextCell = getUnvisitedNeighbor(curr, map)

        if nextCell:
            // Move to the neighbor and push it onto the stack.
            move(direction(curr, nextCell))
            stack.push(nextCell)
            visited.add(nextCell)
        else:
            // If no unvisited neighbors, backtrack.
            stack.pop()
            if not stack.empty:
                move(direction(curr, stack.peek()))
```

**State Machine Diagram:**

1.  **LOOK:** Capture the $3 \times 3$ local view.
2.  **UPDATE:** Integrate the view into the global coordinate map.
3.  **DECIDE:** Choose the next unvisited neighbor or backtrack.
4.  **MOVE:** Execute the movement command.
5.  **CHECK:** Determine if the new position is the exit.

#### Mutation Resilience and Fault Tolerance

The high frequency of mutations makes the DarkNet a "noisy" environment where processes are frequently interrupted.

**CS Mapping:** Fault-Tolerant Computing / Checkpoint-Restart.

**Problem Analysis:**
An authentication attempt on a Tier 4 server can take several minutes. If the server restarts or moves during this time, the attempt is lost.

**Strategy: Checkpointing and Persistence**

1.  **Centralized State:** Store all discovered passwords, network maps, and progress in a persistent file (e.g., `DARKNET_STATE.json`).
2.  **Idempotent Solvers:** Solvers should be able to resume from where they left off. For example, a binary search solver should store its current `low` and `high` bounds.
3.  **Auto-Reconnect:** A background manager should constantly monitor active sessions. If a session is lost due to a restart, it should immediately re-authenticate using the stored password.

#### Stasis Link Management

Stasis links are a limited resource that can make a server immutable, protecting it from mutations.

**CS Mapping:** Resource Allocation / Minimum Dominating Set.

**Problem Analysis:**
You have a limited number of stasis links. Using them randomly is inefficient. You want to use them to create a "backbone" of stable servers that bridge gaps and provide high-RAM compute nodes.

**Strategy: Strategic Backbone**

1.  **Bridge Servers:** Always stasis-link servers that have successfully jumped an air gap.
2.  **High-Tier Solvers:** Stasis-link servers where you are currently running a long-duration Tier 4 solver.
3.  **Sniffer Nodes:** Stasis-link `OpenWebAccessPoint` nodes to ensure continuous packet capture.
4.  **Backbone Path:** Create a stable path from the root to the deepest accessible level.

#### Packet Sniffing Intelligence

Packet sniffing is a probabilistic process. Optimizing it requires understanding the underlying distribution.

**CS Mapping:** Probabilistic Information Gathering.

**Problem Analysis:**
The inclusion rate of passwords in the packet stream decays exponentially with difficulty. However, the $8\times$ multiplier on `OpenWebAccessPoint` nodes is a massive advantage.

**Strategy: Distributed Sniffing**
Deploy sniffing scripts on _every_ conquered `OpenWebAccessPoint` node. The aggregate rate of password discovery will be the sum of the individual rates.

#### Clue System Exploitation

The clue system provides partial information that can be fused to reconstruct full passwords.

**CS Mapping:** Bayesian Inference / Information Fusion.

**Problem Analysis:**
A single clue might give you "Characters at index 2 and 5 are 'a' and '7'". By aggregating multiple such clues for the same server, you can eventually fill in the entire password without ever running a solver.

**Strategy: The Password Blackboard**
Maintain a "blackboard" where all clues are posted. A background process should constantly check if any password on the blackboard has enough information to be "solved" (e.g., all characters known, or search space reduced to a small enough size for brute-force).

---

## Part 2: Strategy Guide

This section provides a tactical walkthrough for conquering the DarkNet, from the initial entry to the final lab.

### Phase 0: Reconnaissance

Before making any moves, you must understand the terrain.

1.  **Initial Scan:** Use the root node to scan all visible servers.
2.  **Grid Mapping:** Identify the (x, y) coordinates of each server. Note that depth corresponds to the row index.
3.  **Model Identification:** For each server, record its authentication model and difficulty.
4.  **Gap Identification:** Mark the rows 8, 16, 24, and 32 as air gaps.

**Decision Tree:**

- Is the server at Depth 0? -> Use ZeroLogon.
- Is the server at Depth 1-7? -> Prioritize Tier 1 models.
- Is the server an `OpenWebAccessPoint`? -> Mark as high priority for Phase 1.

### Phase 1: Beachhead (Depth 0-7)

The goal of this phase is to establish a stable presence in the first segment of the grid and begin accumulating resources.

1.  **Rapid Expansion:** Solve all Tier 0 and Tier 1 servers. These are fast and provide the initial RAM needed for more complex scripts.
2.  **Clue Harvesting:** Every successful authentication has a 70% chance of providing a clue. Feed these into your central database immediately.
3.  **Sniffer Deployment:** As soon as an `OpenWebAccessPoint` is conquered, deploy a sniffer script.
4.  **Stasis Anchoring:** Choose 2-3 servers with high connectivity and apply stasis links. These will be your "safe harbors" if the rest of the network mutates unfavorably.

**RAM Budgeting:**

- Sniffer Script: 2.0 GB
- Tier 1 Solver: 1.6 GB
- Manager Script: 4.0 GB
  Total: ~8 GB. Most Depth 0-7 servers have 4-16 GB, so you can run 1-2 tasks per server.

### Phase 2: Crossing Air Gaps

The air gaps are the primary obstacles to progress. You cannot "scan" across them.

1.  **The Waiting Game:** Monitor the servers at Depth 7. Wait for a mutation to move one of them to Depth 9.
2.  **The Clue Jump:** While waiting, check your database. You may have already received a full password for a Depth 9+ server from a clue or a sniffer.
3.  **Direct Connection:** Use `connectToSession(hostname, password)` to jump the gap. This command is the "silver bullet" of DarkNet strategy.
4.  **Foothold Stabilization:** Once across, immediately stasis-link the new server. This ensures you don't lose your progress if the network mutates again.

**Tactical Insight:**
Don't waste time trying to "find" a path across the gap. The gap is a physical disconnect. Use the side-channels (clues, sniffing, migration) to bypass it entirely.

### Phase 3: Deep Penetration (Depth 8-39)

As you move deeper, the models become more difficult and the authentication times increase.

1.  **Solver Selection:** Use the specialized solvers for Tier 3 and Tier 4 models.
2.  **Thread Optimization:**
    Authentication time is calculated as:
    $$\text{AuthTime} = 850\text{ms} \times \text{skillFactor} \times \text{threadsFactor} \times \dots$$
    Where $\text{threadsFactor} \approx 1 / \sqrt{\text{threads}}$.
    Increasing threads significantly reduces the time for Tier 4 servers, which can otherwise take 10+ minutes.
3.  **Parallelism:** Run multiple solvers on different servers simultaneously. Use your home RAM for the most intensive tasks.
4.  **Backdoor Management:** Backdooring a server provides a permanent connection but increases the `surplus` factor, slowing down _all_ future authentication attempts by $1.07^{\text{surplus}}$. Only backdoor the minimum number of servers required to maintain a path to the Labyrinth.

**Thread Formula:**
To achieve a target `authTime` of $T$, the required threads $N$ is:
$$N = \left( \frac{850\text{ms} \times \text{skillFactor}}{T} \right)^2$$

### Phase 4: Labyrinth

The Labyrinth is the final stretch. It requires a different set of tools.

1.  **Stateful Exploration:** Your script must maintain a persistent map of the maze. If the script restarts, it should be able to resume from its last known coordinates.
2.  **Exit Priority:** The goal is not to map the entire maze, but to find the exit as quickly as possible. Use a heuristic that prioritizes moving towards the bottom-right corner (where the exit is typically located).
3.  **Lab Progression:** There are 7 labs. Each one is larger and more complex than the last. Ensure your mapping algorithm can handle increasing grid sizes.

### Architecture Recommendations

A successful DarkNet campaign requires a robust software architecture.

**1. Central Password Database (`/data/passwords.json`)**
All scripts should read from and write to this file. It acts as the "source of truth" for the network.

```json
{
    "server-alpha": {
        "password": "hunter2",
        "depth": 5,
        "model": "DeskMemo_3.1",
        "stasis": true
    }
}
```

**2. The Orchestrator (`darknet-manager.js`)**
A single, high-RAM script running on `home` that:

- Monitors the network for mutations.
- Dispatches solvers to new targets.
- Manages stasis links.
- Aggregates clues and sniffer data.

**3. Specialized Solvers**
Instead of one giant script, use small, specialized scripts for each model (e.g., `solve-crt.js`, `solve-mastermind.js`). This allows you to run them on the limited RAM of DarkNet servers.

**4. Error Recovery Procedure**
Every `authenticate` call should be wrapped in a retry loop:

```pseudocode
function robustAuthenticate(target, password):
    while true:
        try:
            return authenticate(target, password)
        catch (error):
            if error == "Server Offline":
                wait(30s) // Wait for restart
            else:
                throw error
```

### Performance Considerations

- **Hacking Skill:** Your hacking level is the single biggest factor in authentication speed. Grind skill before attempting Tier 4 servers.
- **RAM Bottlenecks:** DarkNet servers have very little RAM. Optimize your scripts for size. Use `ns.print` sparingly and avoid large libraries.
- **Distance:** Grid distance only affects the initial `scan`. Once you have a password, `connectToSession` is instantaneous regardless of distance.

### Key Tactical Insights

- **Sync is King:** `connectToSession` is synchronous. Use it to build a fast, responsive automation loop.
- **Clues are Undervalued:** A well-implemented clue aggregator can solve 50% of the network without ever running a complex math solver.
- **Stasis is a Shield:** Use stasis links to protect your most valuable assets (sniffers and bridge nodes).
- **Don't Over-Backdoor:** The $1.07^n$ penalty is exponential. Backdooring 10 unnecessary servers will double your authentication times.

---

### Complete Solver Registry Mapping

| Model               | Tier | Problem Class         | Solver Script           |
| :------------------ | :--- | :-------------------- | :---------------------- |
| ZeroLogon           | 0    | Null Auth             | `solve-null.js`         |
| DeskMemo_3.1        | 1    | String Extraction     | `solve-echo.js`         |
| FreshInstall_1.0    | 1    | Dictionary (Static)   | `solve-dict-static.js`  |
| CloudBlare(tm)      | 1    | Filtering             | `solve-filter.js`       |
| Laika4              | 2    | Dictionary (Themed)   | `solve-dict-dog.js`     |
| NIL                 | 2    | Oracle (Per-Char)     | `solve-oracle-char.js`  |
| Pr0verFl0           | 2    | Buffer Overflow       | `solve-overflow.js`     |
| PHP 5.4             | 3    | Permutation / RMSD    | `solve-rmsd.js`         |
| DeepGreen           | 3    | Mastermind            | `solve-mastermind.js`   |
| BellaCuore          | 3    | Binary Search (Roman) | `solve-bs-roman.js`     |
| AccountsManager_4.2 | 3    | Binary Search (Int)   | `solve-bs-int.js`       |
| OctantVoxel         | 3    | Base Conversion       | `solve-base.js`         |
| Factori-Os          | 3    | Factorization         | `solve-factors.js`      |
| OpenWebAccessPoint  | 3    | Packet Sniffing       | `run-sniffer.js`        |
| KingOfTheHill       | 3    | Ternary Search        | `solve-ternary.js`      |
| RateMyPix.Auth      | 3    | Oracle (Count)        | `solve-oracle-count.js` |
| PrimeTime 2         | 4    | Prime Factorization   | `solve-prime.js`        |
| TopPass             | 4    | Dictionary (Large)    | `solve-dict-large.js`   |
| EuroZone Free       | 4    | Dictionary (EU)       | `solve-dict-eu.js`      |
| 2G_cellular         | 4    | Timing Attack         | `solve-timing.js`       |
| 110100100           | 4    | Binary Decoding       | `solve-binary.js`       |
| MathML              | 4    | Expression Eval       | `solve-math.js`         |
| OrdoXenos           | 4    | XOR Cipher            | `solve-xor.js`          |
| BigMo%od            | 4    | CRT                   | `solve-crt.js`          |

### RAM Budget Calculations

| Script Type      | Base RAM | Thread Overhead | Total (1 Thread) |
| :--------------- | :------- | :-------------- | :--------------- |
| Manager          | 4.0 GB   | N/A             | 4.0 GB           |
| Tier 1 Solver    | 1.6 GB   | 0.1 GB          | 1.7 GB           |
| Tier 2 Solver    | 2.4 GB   | 0.2 GB          | 2.6 GB           |
| Tier 3 Solver    | 3.2 GB   | 0.4 GB          | 3.6 GB           |
| Tier 4 Solver    | 4.8 GB   | 0.8 GB          | 5.6 GB           |
| Sniffer          | 2.0 GB   | N/A             | 2.0 GB           |
| Labyrinth Solver | 6.4 GB   | N/A             | 6.4 GB           |

### Architecture Diagram (ASCII)

```text
+-------------------------------------------------------+
|                     HOME SERVER                       |
|  +-------------------------------------------------+  |
|  |               darknet-manager.js                |  |
|  |  (Orchestrator, Map Builder, Stasis Manager)    |  |
|  +-----------------------+-------------------------+  |
|                          |                            |
|          +---------------+---------------+            |
|          |                               |            |
|  +-------v-------+               +-------v-------+    |
|  | Password DB   |               | Network State |    |
|  | (JSON File)   |               | (JSON File)   |    |
|  +-------+-------+               +-------+-------+    |
|          |                               |            |
+----------|-------------------------------|------------+
           |                               |
           |       +---------------+       |
           +------>| DARKNET GRID  |<------+
                   +-------+-------+
                           |
           +---------------+---------------+
           |               |               |
   +-------v-------+ +-----v-------+ +-----v-------+
   |  Node (D:5)   | |  Node (D:12) | |  Node (D:35) |
   |  (Sniffer)    | |  (Solver)    | |  (Labyrinth) |
   +---------------+ +---------------+ +---------------+
```

### Error Recovery Procedures

1.  **Mutation Detected:**
    - Pause all active solvers.
    - Re-scan the network from the root.
    - Update the global map.
    - For each solver, check if the target is still reachable.
    - If reachable, resume. If not, re-path.
2.  **Server Restart:**
    - Catch the "Authentication Failed" error.
    - Check if the server is back online.
    - Re-authenticate using the stored password.
    - Restart any background scripts (sniffers).
3.  **Air Gap Collapse:**
    - If a bridge node moves back across the gap, the connection is lost.
    - Trigger the "Phase 2: Crossing Air Gaps" logic to find a new bridge.
4.  **Labyrinth Reset:**
    - If the labyrinth script crashes, reload the coordinate map from the state file.
    - Resume exploration from the last known position.

### Final Tactical Checklist

- [ ] Hacking skill is at least 500 above the target server's requirement.
- [ ] Central Password DB is initialized and writable.
- [ ] Sniffers are deployed on all available `OpenWebAccessPoint` nodes.
- [ ] Stasis links are applied to bridge nodes and high-RAM servers.
- [ ] Backdoor count is kept to the absolute minimum.
- [ ] Thread counts are optimized for Tier 4 solvers based on available RAM.
- [ ] Labyrinth mapping script is ready for deployment.

(End of Strategy Guide)
