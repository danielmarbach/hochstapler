Feature: Trading between players
  Players can make each other offers at any time: money for properties.

  Background:
    Given Anna and Ben play a game in Switzerland
    And Ben already owns "Weggisgasse"
    And it is Anna's turn

  Scenario: Ben accepts Anna's offer and the property changes owner
    When Anna offers Ben 150 for "Weggisgasse"
    Then Ben has a trade offer from Anna
    When Ben accepts the offer from Anna
    Then Anna owns "Weggisgasse"
    And Ben does not own "Weggisgasse"
    And Anna has a balance of 1'850
    And Ben has a balance of 2'150

  Scenario: Ben rejects the offer and nothing changes
    When Anna offers Ben 150 for "Weggisgasse"
    And Ben rejects the offer from Anna
    Then the trade of Anna shows the status "abgelehnt"
    And Ben owns "Weggisgasse"
    And Anna has a balance of 2'000

  Scenario: Ben counters with a higher price and Anna accepts the counteroffer
    When Anna offers Ben 200 for "Weggisgasse"
    And Ben counters the offer from Anna and asks 260
    Then Anna has a trade offer from Ben
    And the trade of Anna shows the status "mit Gegenangebot beantwortet"
    And Anna sees the counter note "260" on the offer from Ben
    When Anna accepts the offer from Ben
    Then Anna owns "Weggisgasse"
    And Ben does not own "Weggisgasse"
    And Anna has a balance of 1'740
    And Ben has a balance of 2'260

  Scenario: A negotiation allows three counteroffers, then only accept or decline remain
    When Anna offers Ben 200 for "Weggisgasse"
    And Ben counters the offer from Anna and asks 260
    And Anna counters the offer from Ben and pays 230
    And Ben counters the offer from Anna and asks 250
    Then Anna cannot answer the offer from Ben with a counteroffer
    When Anna accepts the offer from Ben
    Then Anna owns "Weggisgasse"
    And Anna has a balance of 1'750
    And Ben has a balance of 2'250
