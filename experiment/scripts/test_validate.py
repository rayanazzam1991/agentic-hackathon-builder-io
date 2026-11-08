"""Negative checks for evidence/reference integrity; synthetic outputs are not model results."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from validate import ROOT, read_package, schema_check, validate_output, validate_package
from prepare import prepare


def minimal_output(p):
    return {'contract_version':'1.0','case_id':p['case_id'],'story':p['story'],
            'checkpoint_ids':{k:v['id'] for k,v in p['checkpoints'].items()},
            'evidence_version':p['evidence_version'],
            'coverage':{'included_source_ids':[s['id'] for s in p['sources']], 'gaps':[], 'limitations':['Synthetic validator test only.']},
            'completed_work':[], 'unfinished_work':[],
            'claims':[{'id':'test','topic':'test','statement':'Synthetic reference check only.',
                       'category':'possible_impact','epistemic_label':'supported','knowledge_basis':'documentary',
                       'review_state':'unreviewed','story_relevance':'Synthetic test.',
                       'references':[{'source_id':'handover','locator':'L3-L4'}]}],
            'relevant_message_ids':[], 'excluded_message_ids':[], 'conflicts':[],
            'open_questions':[{'id':'q','question':'Synthetic test?', 'references':[]}],
            'proposed_checks':[], 'follow_ups':[], 'preserved_review_ids':[]}


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.p = read_package(ROOT / 'fixtures/A.json')
        self.b = minimal_output(self.p)

    def test_valid_structure_is_not_factual_verdict(self):
        validate_output(self.b, self.p)

    def test_v2_narrative_schema_and_strict_boolean(self):
        schema = json.loads((ROOT/'contracts/v2/narrative.schema.json').read_text())
        narrative = {'pipeline_version':'2.0','case_id':'A','story':'ATLAS-142',
                     'evidence_version':1,'paragraphs':[], 'open_questions':[],
                     'dm_drafts':[], 'proposed_checks':[], 'preserved_review_ids':[],
                     'review_required':True}
        schema_check(narrative, schema)
        for invalid in [1, 'true', None]:
            narrative['review_required'] = invalid
            with self.assertRaisesRegex(ValueError, 'expected boolean'):
                schema_check(narrative, schema)

    def test_duplicate_source_rejected(self):
        self.p['sources'].append(copy.deepcopy(self.p['sources'][0]))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            validate_package(self.p)

    def test_path_escape_rejected(self):
        self.p['sources'][3]['image_path'] = '../../README.md'
        with self.assertRaisesRegex(ValueError, 'escapes'):
            validate_package(self.p)

    def test_image_region_bounds_rejected(self):
        self.p['sources'][3]['regions']['member-form'][2] = 9999
        with self.assertRaisesRegex(ValueError, 'outside image'):
            validate_package(self.p)

    def test_oversize_text_rejected(self):
        self.p['sources'][0]['lines'].append('x' * 20001)
        with self.assertRaisesRegex(ValueError, 'budget'):
            validate_package(self.p)

    def test_invalid_checkpoint_rejected(self):
        self.p['checkpoints']['return']['at'] = '2026-10-25T09:00:00+02:00'
        with self.assertRaisesRegex(ValueError, 'out of order'):
            validate_package(self.p)

    def test_fabricated_source_rejected(self):
        self.b['claims'][0]['references'][0]['source_id'] = 'not-provided'
        with self.assertRaisesRegex(ValueError, 'unknown source'):
            validate_output(self.b, self.p)

    def test_out_of_bounds_lines_rejected(self):
        self.b['claims'][0]['references'][0]['locator'] = 'L3-L999'
        with self.assertRaisesRegex(ValueError, 'out of bounds'):
            validate_output(self.b, self.p)

    def test_missing_support_rejected(self):
        self.b['claims'][0]['references'] = []
        with self.assertRaisesRegex(ValueError, 'no references'):
            validate_output(self.b, self.p)

    def test_fabricated_region_rejected(self):
        self.b['claims'][0]['references'] = [{'source_id':'figma-after','locator':'nonexistent'}]
        with self.assertRaisesRegex(ValueError, 'unknown image region'):
            validate_output(self.b, self.p)

    def test_unexecuted_check_cannot_pass(self):
        self.b['proposed_checks'] = [{'description':'test','execution_state':'passed','references':[]}]
        with self.assertRaisesRegex(ValueError, 'invalid enum'):
            validate_output(self.b, self.p)

    def test_answer_without_reply_rejected(self):
        self.b['follow_ups'] = [{'question_id':'q','recipient':'Leo','draft':'Why?',
                                'delivery_state':'not_sent','reply_state':'answered',
                                'reply_source_ids':[],'remaining_uncertainty':'unknown'}]
        with self.assertRaisesRegex(ValueError, 'without recorded reply'):
            validate_output(self.b, self.p)

    def test_unpreserved_review_rejected(self):
        self.p['saved_reviews'] = [{'id':'REVIEW-1'}]
        with self.assertRaisesRegex(ValueError, 'review IDs not preserved'):
            validate_output(self.b, self.p)

    def test_disjoint_message_selection(self):
        self.b['relevant_message_ids'] = ['m1']
        self.b['excluded_message_ids'] = ['m1']
        with self.assertRaisesRegex(ValueError, 'both included and excluded'):
            validate_output(self.b, self.p)

    def test_prepare_excludes_answer_keys_and_preserves_hashes(self):
        import hashlib
        with tempfile.TemporaryDirectory() as temp:
            out = prepare('A', Path(temp) / 'A')
            manifest = json.loads((out/'manifest.json').read_text())
            self.assertEqual(manifest['input_sha256'], hashlib.sha256((out/'input.json').read_bytes()).hexdigest())
            self.assertFalse((out/'answer-keys').exists())
            self.assertEqual(manifest['state'], 'prepared_not_generated')
            with self.assertRaisesRegex(ValueError, 'already exists'):
                prepare('A', out)

    def test_followup_preparation_requires_actual_prior_output(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError, 'actual prior generated brief'):
                prepare('D-initial', Path(temp)/'D')


if __name__ == '__main__':
    unittest.main()
