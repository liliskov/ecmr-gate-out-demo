import { readFileSync } from 'node:fs';
import { DataFactory, Parser, Store } from 'n3';
import { ODRLEngineMultipleSteps, ODRLEvaluator, parseSingleComplianceReport } from 'odrl-evaluator';
import SHACLValidator from 'rdf-validate-shacl';

const { literal, namedNode, quad } = DataFactory;
const demo = 'https://example.org/process-demo#';
const odrl = 'http://www.w3.org/ns/odrl/2/';
const report = 'https://w3id.org/force/compliance-report#';
const rdfType = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const dateTime = namedNode('http://www.w3.org/2001/XMLSchema#dateTime');
const incomingEvent = namedNode(demo + 'incomingEvent');

function readTurtle(name) {
  return new Parser().parse(readFileSync(new URL(`./case/${name}`, import.meta.url), 'utf8'));
}

const shapes = new Store(readTurtle('event-shape.ttl'));
const policy = readTurtle('policy.ttl');
const evaluator = new ODRLEvaluator(new ODRLEngineMultipleSteps());

export async function validateEvent(event, datatypes) {
  const graph = new Store();
  for (const [field, value] of Object.entries(event)) {
    const predicate = namedNode(demo + encodeURIComponent(field));
    const datatype = Object.hasOwn(datatypes, field) ? datatypes[field] : null;
    let term;
    if (typeof value === 'string' && datatype) {
      term = literal(value, namedNode(datatype));
    } else if (typeof value === 'object') {
      term = literal(JSON.stringify(value), namedNode(demo + 'jsonValue'));
    } else {
      term = literal(value);
    }
    graph.addQuad(incomingEvent, predicate, term);
  }

  const validation = await new SHACLValidator(shapes).validate(graph);
  return validation.results.map(result => ({
    field: result.path?.value.split('#').pop(),
    message: result.message.map(term => term.value).join(' '),
  }));
}

export async function authorise(sender, target) {
  const request = namedNode('urn:ecmr-demo:request');
  const rule = namedNode('urn:ecmr-demo:request-rule');
  const requestQuads = [
    quad(request, rdfType, namedNode(odrl + 'Request')),
    quad(request, namedNode(odrl + 'permission'), rule),
    quad(rule, rdfType, namedNode(odrl + 'Permission')),
    quad(rule, namedNode(odrl + 'assignee'), namedNode(sender)),
    quad(rule, namedNode(odrl + 'action'), namedNode(odrl + 'modify')),
    quad(rule, namedNode(odrl + 'target'), namedNode(target)),
  ];
  const context = [
    quad(
      namedNode('http://example.com/request/currentTime'),
      namedNode('http://purl.org/dc/terms/issued'),
      literal(new Date().toISOString(), dateTime),
    ),
  ];

  const quads = await evaluator.evaluate(policy, requestQuads, context);
  const result = parseSingleComplianceReport(quads);
  const activeRules = result.ruleReport.filter(rule => rule.activationState === report + 'Active');
  const permitted = activeRules.some(rule => rule.type === report + 'PermissionReport');
  const prohibited = activeRules.some(rule => rule.type === report + 'ProhibitionReport');
  return {
    decision: permitted && !prohibited ? 'permit' : 'deny',
    policy: result.policy.value,
    rules: result.ruleReport.map(rule => ({
      id: rule.rule.value,
      status: rule.activationState?.split('#').pop(),
      premises: rule.premiseReport.map(premise => ({
        check: premise.type.split('#').pop(),
        status: premise.satisfactionState?.split('#').pop(),
      })),
    })),
  };
}
