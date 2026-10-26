Feature: Rolling, moving and buying properties
  As a player I want to roll, move to a tile and buy it
  so that I own streets and can collect rent.

  Background:
    Given Anna and Ben play a game in Switzerland
    And it is Anna's turn

  Scenario: Anna buys the street she landed on
    Given the dice sequence is 2+4
    When Anna rolls
    Then Anna is offered the chance to buy "Weggisgasse"
    When Anna buys the property
    Then Anna has a balance of 1'900
    And Anna owns "Weggisgasse"
    And Anna can end her turn

  Scenario: Ben pays Anna rent
    Given Anna already owns "Weggisgasse"
    And it is Ben's turn
    And the dice sequence is 2+4
    When Ben rolls
    Then Ben has a balance of 1'996
    And Anna has a balance of 2'004
    And Anna sees that Ben has a balance of 1'996

  Scenario: Doubles give Anna another roll
    Given Anna already owns "Weggisgasse"
    And the dice sequence is 2+4, 3+3
    When Anna rolls
    Then Anna can end her turn
