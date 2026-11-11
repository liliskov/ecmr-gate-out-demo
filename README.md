# Terminal gate-out to eCMR takeover

The terminal reports **Terminal visit [completed]** when the truck gates out. The eCMR provider receives it at **Takeover recorded** and records **taken over**, with the terminal's interchange receipt as evidence. The demo starts with an assigned consignment note and uses a test receipt reference. [PILOTS takeover step](https://www.pilots.community/LivingLab1Explorer#bpmn/E/Task_Takeover)

## Run it in VS Code

Unzip the download and open the `ecmr-gate-out-demo` folder in VS Code. On a Mac, these commands open it from a `projects` folder if the ZIP is in Downloads.

```sh
mkdir -p ~/projects
cd ~/projects
unzip ~/Downloads/ecmr-gate-out-demo.zip
cd ecmr-gate-out-demo
code .
```

In VS Code, open **Terminal → New Terminal**. Use Node 22 or newer. Install the locked dependencies, create the test keys and start the receiver.

```sh
node --version
npm ci --ignore-scripts --no-audit --no-fund
npm run setup
npm start
```

The receiver listens at `http://127.0.0.1:8787`. Leave it running and open a second VS Code terminal in the same folder.

```sh
curl -s http://127.0.0.1:8787/state
npm run send -- wrong-sender
npm run send -- missing-receipt
npm run send -- valid
npm run send -- valid
curl -s http://127.0.0.1:8787/state
```

| Message | What to look for |
| --- | --- |
| `wrong-sender` | **403 denied.** Terminal B's signature verifies and the event conforms. FORCE returns an unsatisfied `PartyReport` for this note. |
| `missing-receipt` | **422 rejected.** Terminal A's signature verifies. SHACL identifies the missing `receiptRef`. |
| First `valid` | **200 accepted.** Terminal A has permission for this note. It moves from `assigned` to `taken_over` and records the receipt reference. |
| Second `valid` | **200 duplicate.** The receiver recognises the same signed event. The history still contains one transition. |

`npm run send -- tampered` changes the receipt reference after signing and demonstrates a **401** at the identity check. `npm test` exercises the receiver independently, including two concurrent copies of the valid message. Restart the receiver with **Ctrl+C**, then `npm start`, to reset the note before the meeting.

## What each file does

| File | Responsibility |
| --- | --- |
| `send.mjs` and `case/event.json` | Build the sample terminal message, sign its exact bytes with Ed25519, and send it to the provider's HTTP inbox. |
| `identities.mjs` and `setup.mjs` | Bind test organisation identifiers to locally generated keys. The receiver loads the public keys. |
| `case/event-shape.ttl` | Define which data the receiving step expects. The validator checks the event's RDF representation. |
| `case/policy.ttl` | Grant the nominated terminal permission to request this update on the sample note. |
| `rules.mjs` | Run SHACL and the published FORCE ODRL Evaluator. The ODRL report shows which checks were satisfied. |
| `case/model.json` and `server.mjs` | Bind the visit and container to the note, check the current state and record the accepted change once. |

**To adapt the example**, define the next case's event, shape, permission and transition in the `case/` files. Reuse the signing, inbox, evaluation and state transition code. Use the BPMN to find the event source, receiver, evidence and resulting state.

This is a loopback demo with test organisations and one in-memory consignment note. The receipt reference is synthetic. `GET /state` is a local operator view. The signed event authenticates the terminal notification, and the workflow records the receiver's own state. The federated identity integration is a separate choice. The published evaluator uses an `odrl:Request` in this implementation. The upstream PILOTS browser demo uses its extended evaluator for weighing and carries additional process context.

## Process files and resources

- `references/` contains all six supplied BPMN files, the secure release Draw.io file and the workshop slides. Start with **BPMN Terminal Visit Container Pickup** and **BPMN eCMR Full Container Delivery**. Follow `Task_GateOut` to `Obs_VisitCompletedEcmr` on the terminal side and `Msg_VisitCompleted` to `Task_Takeover` on the provider side.
- The workshop uses an invoice event to illustrate a signed payload and a policy guard on a state transition. The upstream PILOTS weighing demo applies the same ideas to a different process. [PILOTS demo](https://knowledgeonwebscale.github.io/pilots-demonstrator/) · [Source and walkthrough](https://github.com/KNowledgeOnWebScale/pilots-demonstrator) · [Example service policies](https://github.com/KNowledgeOnWebScale/PILOTS-service-policies)
- Use the W3C specs for the data and permission layers, and the FORCE examples to inspect a policy report. [SHACL](https://www.w3.org/TR/shacl/) · [ODRL](https://www.w3.org/TR/odrl-model/) · [FORCE evaluator](https://github.com/odrl-force/ODRL-Evaluator) · [FORCE demo](https://odrl-force.github.io/ODRL-Evaluator-Demo/)
- For identity and connectivity, the meeting discussed a federated identity component alongside the connector. [Eclipse IdentityHub](https://github.com/eclipse-edc/IdentityHub) · [DCP](https://github.com/eclipse-dataspace-dcp/decentralized-claims-protocol) · [Dataspace Protocol](https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/) · [Eclipse EDC](https://github.com/eclipse-edc/Connector) · [Simpl](https://digital-strategy.ec.europa.eu/en/policies/simpl) · [IDSA](https://internationaldataspaces.org/)
- The supplied BPMN processes are descriptive models with `isExecutable="false"`. This demo implements one transition based on those models. [Flowable engine](https://github.com/flowable/flowable-engine/tree/main) · [Flowable article](https://www.flowable.com/blog/engineering/bpmn-is-dead-now)
